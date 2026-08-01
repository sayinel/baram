import type {
  ExtensionContext,
  InstalledPlugin,
  PluginEventName,
  PluginFileEvent,
  PluginModule,
} from "./types";

import {
  pluginListDev,
  pluginPrepareScopes,
  toInstalledDevPlugin,
} from "../ipc/plugin-invoke";
import { contextRootOf, useContextStore } from "../stores/context/context";
import { usePluginStore } from "../stores/system/plugin";
import { logger } from "../utils/logger";
import { BUILTIN_PLUGINS } from "./builtin";
import {
  createExtensionContext,
  emitPluginEvent,
  unregisterPluginUI,
} from "./extension-context";
// §69 Plugin Lifecycle — App-level plugin management
import { pluginLoader } from "./plugin-loader";
import {
  refreshRevocations,
  REVOCATION_REFRESH_BUDGET_MS,
} from "./revocation-client";
import {
  deliverSandboxEvent,
  setContextResolver,
} from "./sandbox/sandbox-event-bridge";
import { closeOrphanSandboxWebviews } from "./sandbox/sandbox-orphans";

interface ActiveBuiltin {
  context: ExtensionContext;
  id: string;
  module: PluginModule;
}

/** Initialize all enabled plugins at app startup. Budget: 200ms total. */
export async function initializePlugins(): Promise<void> {
  // §260 3c-3 — close sandbox webviews left over from a previous main-realm
  // lifetime, before any load. A reload (HMR, refresh,
  // remount) empties this realm's bookkeeping while the `plugin-*` webview keeps
  // running with its Rust capabilities intact, and the next load then fails on a
  // taken label. Found by the live smoke.
  //
  // Above the gate on purpose (3c-3 security review, M4): revoking a leftover sandbox
  // is right whether or not plugins are enabled — arguably *more* right when they are
  // disabled. Today the gate is a build-time constant so no orphan can exist in a
  // disabled build, but Phase 5 changes what that gate is, and "disable plugins"
  // must never mean "skip revoking the sandboxes that most need it".
  // `ownedIds` is what keeps a SECOND call from closing what the first one started
  // (3c-3 code review, HIGH-1) — `React.StrictMode` double-invokes this effect in
  // dev, which is the only environment where the sandbox runs at all.
  await closeOrphanSandboxWebviews({
    ownedIds: pluginLoader.liveSandboxIds(),
  });

  // §260 Phase 4a — teach the sandbox event bridge how a path becomes a context, before
  // any load can produce a session to deliver to. Until this runs the bridge resolves
  // nothing, so a path-bearing event is DROPPED rather than sent with an absolute path —
  // fail-closed is the right default for the one translation that keeps the user's home
  // directory out of the sandboxed tier.
  setContextResolver(locateInContext);

  // Built-ins load FIRST, and unconditionally: they are app code compiled into this
  // bundle, so the plugin API is their integration surface rather than a trust
  // boundary. They loaded ahead of the §259 release gate for the same reason, and
  // keeping the order after §260 Phase 5 removed that gate costs nothing.
  await loadBuiltinPlugins();

  // Grant asset scope for ~/.baram/plugins before any load (see Global Constraints).
  await pluginPrepareScopes().catch((err) =>
    logger.error("[PluginLifecycle] prepare scopes failed:", err),
  );

  // §69 — refresh the withdrawal list BEFORE any installed plugin loads, bounded.
  //
  // This was fire-and-forget at the top of the function, which lost the race as a
  // rule: a local `asset://` import beats a Pages round trip essentially always. A
  // `trusted` plugin that wins it once runs in the main realm, where it can patch
  // `window.__TAURI_INTERNALS__.invoke` — the transport this very refresh uses — and
  // answer with a well-formed empty list. That list is accepted by design (a
  // withdrawal has to be revocable) and PERSISTED, so one won race disarmed
  // revocation permanently, on every later launch, while the entry stayed correctly
  // published. Security review of this branch found it.
  //
  // Bounded, because the offline guarantee still stands: the stored list already
  // governs the gate, so a timeout costs freshness and never protection. The cost of
  // being offline is one wait of REVOCATION_REFRESH_BUDGET_MS per launch.
  await Promise.race([
    refreshRevocations(),
    new Promise((resolve) => setTimeout(resolve, REVOCATION_REFRESH_BUDGET_MS)),
  ]);

  const { installedPlugins } = usePluginStore.getState();
  const enabledPlugins = Object.values(installedPlugins).filter(
    (p) => p.enabled,
  );

  if (enabledPlugins.length > 0) {
    const startTime = performance.now();

    // Sort by dependencies (simple topological sort)
    const sorted = sortByDependencies(enabledPlugins);

    // Load plugins in parallel (no dependency ordering for now since dependencies are rare)
    const results = await Promise.allSettled(
      sorted.map((plugin) =>
        pluginLoader
          .loadPlugin(plugin.installPath, plugin.manifest)
          .catch((err) => {
            logger.error(
              `[PluginLifecycle] Failed to load ${plugin.manifest.id}:`,
              err,
            );
            usePluginStore.getState().setError(plugin.manifest.id, String(err));
            throw err;
          }),
      ),
    );

    const loaded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    const elapsed = performance.now() - startTime;

    logger.info(
      `[PluginLifecycle] Loaded ${loaded} plugins (${failed} failed) in ${elapsed.toFixed(0)}ms`,
    );

    if (elapsed > 200) {
      logger.warn(
        `[PluginLifecycle] Plugin loading exceeded 200ms budget: ${elapsed.toFixed(0)}ms`,
      );
    }
  }

  // Dev plugins (source of truth = Rust config; not persisted in the store).
  try {
    const devRaw = await pluginListDev();
    const devPlugins: InstalledPlugin[] = devRaw.map(toInstalledDevPlugin);
    usePluginStore.getState().setDevPlugins(devPlugins);
    await Promise.allSettled(
      devPlugins.map(async (p) => {
        try {
          if (pluginLoader.isLoaded(p.manifest.id)) {
            logger.warn(
              `[PluginLifecycle] dev plugin ${p.manifest.id} overrides installed`,
            );
            await pluginLoader.reloadPlugin(p.installPath, p.manifest, {
              isDev: true,
            });
          } else {
            await pluginLoader.loadPlugin(p.installPath, p.manifest, {
              isDev: true,
            });
          }
          // Clear any failure from a previous run: the store is persisted, so
          // without this a one-off startup error outlives the run that caused it.
          usePluginStore.getState().setError(p.manifest.id, null);
        } catch (err) {
          logger.error(
            `[PluginLifecycle] dev load failed ${p.manifest.id}:`,
            err,
          );
          usePluginStore.getState().setError(p.manifest.id, String(err));
        }
      }),
    );
  } catch (err) {
    logger.error("[PluginLifecycle] dev plugin init failed:", err);
  }
}

/**
 * §260 Phase 4a — an absolute path as the sandboxed tier is allowed to see it: the
 * containing context's id plus a path relative to its root, POSIX-separated.
 *
 * Exported for its own test: this is the single translation that keeps absolute paths
 * out of the tier, and testing it through `initializePlugins` would mean mocking the
 * whole load path to assert one string.
 *
 * `getContextForPath` is the app's own longest-prefix rule (§81), reused rather than
 * re-derived: a second implementation could disagree about which vault a file belongs
 * to, and this one decides what a plugin is then permitted to read. A file in no
 * registered context returns `null`, and the caller drops the event.
 */
export function locateInContext(absolutePath: string): null | PluginFileEvent {
  const context = useContextStore.getState().getContextForPath(absolutePath);
  if (!context) return null;
  // A `file` context IS the file (§89), so it has no interior path; Rust accepts `""`
  // for exactly this case and refuses anything else against such a context.
  if (context.contextType === "file") return { context: context.id, path: "" };
  // Sliced at the SAME boundary `getContextForPath` matched on, through the shared
  // `contextRootOf` rather than a second copy of the rule (security re-review LOW-4).
  const relative = absolutePath
    .slice(contextRootOf(context.path).length)
    .replace(/^[/\\]+/, "")
    .replace(/\\/g, "/");
  return { context: context.id, path: relative };
}

/** Called when the editor is ready */
export function notifyEditorReady(): void {
  notifyPlugins("editor:ready");
}

/** Called when a file is opened in the editor */
export function notifyFileOpen(filePath: string): void {
  notifyPlugins("file:open", filePath);
}

// --- Built-in plugins (§69) ---

/** Called when a file is saved */
export function notifyFileSave(filePath: string): void {
  notifyPlugins("file:save", filePath);
}

const activeBuiltins: ActiveBuiltin[] = [];

/** Cleanup all plugins on app shutdown */
export async function shutdownPlugins(): Promise<void> {
  await shutdownBuiltinPlugins();
  await pluginLoader.unloadAll();
}

/**
 * Activate the compiled-in plugins through the same ExtensionContext external
 * plugins get. Idempotent: React.StrictMode double-invokes the mounting
 * effect in dev, and a second activation would register every viewer twice.
 */
async function loadBuiltinPlugins(): Promise<void> {
  if (activeBuiltins.length > 0) return;
  for (const { manifest, module } of BUILTIN_PLUGINS) {
    try {
      const context = createExtensionContext(manifest, "");
      await module.activate?.(context);
      activeBuiltins.push({ context, id: manifest.id, module });
    } catch (err) {
      logger.error(
        `[PluginLifecycle] builtin ${manifest.id} activate failed:`,
        err,
      );
    }
  }
}

/**
 * §260 Phase 4a — one app event, both tiers.
 *
 * `emitPluginEvent` reaches trusted plugins, which hold handlers in this realm;
 * `deliverSandboxEvent` reaches sandboxed ones over their transport, translating an
 * absolute path into `{context, path}` on the way (a sandbox is never told a root). The
 * two are called together here, at the app's own notification points, so a new event
 * cannot be wired to one tier and forgotten for the other.
 */
function notifyPlugins(event: PluginEventName, ...args: unknown[]): void {
  emitPluginEvent(event, ...args);
  deliverSandboxEvent(event, args);
}

async function shutdownBuiltinPlugins(): Promise<void> {
  for (const builtin of activeBuiltins.splice(0)) {
    try {
      await builtin.module.deactivate?.();
    } catch (err) {
      logger.error(
        `[PluginLifecycle] builtin ${builtin.id} deactivate failed:`,
        err,
      );
    }
    for (const disposable of builtin.context.subscriptions) {
      try {
        disposable.dispose();
      } catch (err) {
        logger.error(
          `[PluginLifecycle] builtin ${builtin.id} dispose failed:`,
          err,
        );
      }
    }
    unregisterPluginUI(builtin.id);
  }
}

/** Simple topological sort by dependencies */
function sortByDependencies(plugins: InstalledPlugin[]): InstalledPlugin[] {
  const idSet = new Set(plugins.map((p) => p.manifest.id));
  const sorted: InstalledPlugin[] = [];
  const visited = new Set<string>();

  function visit(plugin: InstalledPlugin) {
    if (visited.has(plugin.manifest.id)) return;
    visited.add(plugin.manifest.id);

    // Visit dependencies first
    for (const dep of plugin.manifest.dependencies ?? []) {
      if (idSet.has(dep)) {
        const depPlugin = plugins.find((p) => p.manifest.id === dep);
        if (depPlugin) visit(depPlugin);
      }
    }
    sorted.push(plugin);
  }

  for (const plugin of plugins) {
    visit(plugin);
  }
  return sorted;
}
