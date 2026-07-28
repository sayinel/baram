// §69 Plugin Loader — Dynamic ESM import with lifecycle management
import { convertFileSrc } from "@tauri-apps/api/core";

import type { SandboxSession } from "./sandbox/sandbox-session";
import type {
  Disposable,
  LoadedPlugin,
  PluginManifest,
  PluginModule,
} from "./types";
import type { Extensions } from "@tiptap/core";

import {
  pluginSandboxDeregister,
  pluginSandboxRegister,
} from "../ipc/plugin-invoke";
import { useEditorStore } from "../stores/editor/editor";
import { usePluginStore } from "../stores/system/plugin";
import { logger } from "../utils/logger";
import { withTimeout } from "../utils/with-timeout";
import {
  createExtensionContext,
  setEditorSurfaceBlocked as recordEditorSurfaceBlocked,
  registerHostCommandHandler,
  setEditorInstance,
  unregisterPluginUI,
} from "./extension-context";
import { validateManifest } from "./manifest";
import { declaredSettingsFor } from "./plugin-settings";
import { pluginTrustOf } from "./plugin-trust";
import { usePluginUIStore } from "./plugin-ui-store";
import { createHostRequestHandler } from "./sandbox/host-request-router";
import { watchPluginSettings } from "./sandbox/host-settings-bridge";
import {
  sanitizeStatusBarText,
  statusBarItemId,
} from "./sandbox/host-ui-bridge";
import {
  replayCurrentState,
  subscribeSandbox,
} from "./sandbox/sandbox-event-bridge";
import { SandboxHost } from "./sandbox/sandbox-host";

const ACTIVATE_TIMEOUT = 5000; // 5 seconds
/** §260 3c-2a — bound on closing a sandbox webview, so a wedged close cannot eat
 *  the teardown budget before capability revocation runs. */
const SANDBOX_STOP_TIMEOUT = 1000;
/** Backstop on the whole sandbox teardown, so one hung IPC cannot wedge
 *  `unloadAll()` → `shutdownPlugins()` and leave later plugins loaded. */
const TEARDOWN_TIMEOUT = 5000;

type Importer = (url: string) => Promise<PluginModule>;

export class PluginLoader {
  private readonly importer: Importer;
  /**
   * §260 3c-3 — loads currently running, by plugin id. `loaded` cannot serve this
   * purpose: it is populated only when a load completes. See `loadPlugin`.
   */
  private readonly inFlightLoads = new Map<string, Promise<void>>();
  private loaded = new Map<string, LoadedPlugin>();
  /**
   * §260 3c-2b — sandbox teardowns still running after `unloadPlugin` gave up
   * waiting. A load for the same id awaits the entry first, so a late
   * `plugin_sandbox_deregister` can never revoke the grant the new load just made.
   */
  private readonly pendingTeardowns = new Map<string, Promise<void>>();
  private reloadCounter = 0;
  private readonly sandboxHost: SandboxHost;

  constructor(importer?: Importer, sandboxHost?: SandboxHost) {
    this.importer =
      importer ??
      ((url) => import(/* @vite-ignore */ url) as Promise<PluginModule>);
    this.sandboxHost = sandboxHost ?? new SandboxHost();
  }

  /** Get all loaded plugins */
  getLoadedPlugins(): LoadedPlugin[] {
    return [...this.loaded.values()];
  }

  /** Get Tiptap extensions from all loaded plugins */
  getTiptapExtensions(): Extensions {
    const extensions: Extensions = [];
    for (const plugin of this.loaded.values()) {
      if (!plugin.manifest.tiptapExtensions?.length) continue;
      for (const extDef of plugin.manifest.tiptapExtensions) {
        const ext = plugin.module[extDef.exportName];
        if (ext) {
          extensions.push(ext as Extensions[number]);
        } else {
          logger.warn(
            `[PluginLoader] Plugin ${plugin.id}: export "${extDef.exportName}" not found`,
          );
        }
      }
    }
    return extensions;
  }

  /** Check if a plugin is loaded */
  isLoaded(id: string): boolean {
    return this.loaded.has(id);
  }

  /**
   * §260 3c-3 — plugin ids whose sandbox THIS realm owns (running or starting), for
   * the orphan sweep to leave alone. Exposed here because the sweep runs from
   * `plugin-lifecycle`, which has the loader but not the host.
   */
  liveSandboxIds(): string[] {
    return this.sandboxHost.ownedIds();
  }

  /**
   * Load and activate a single plugin.
   *
   * §260 3c-3 (security review, M2) — CONCURRENT calls for the same id join the
   * first instead of racing it. `this.loaded` is only populated when a load
   * *finishes*, so it cannot dedupe two loads in flight, and two are the normal case:
   * `React.StrictMode` double-invokes mount effects. Racing loads fight
   * over one `plugin-<id>` webview label and one Rust grant — one of them ends up
   * revoking the other's capabilities or closing its window, leaving `loaded` and
   * `live` describing different plugins.
   */
  async loadPlugin(
    installPath: string,
    manifest: PluginManifest,
  ): Promise<void> {
    const inFlight = this.inFlightLoads.get(manifest.id);
    if (inFlight) {
      logger.warn(
        `[PluginLoader] Plugin ${manifest.id} is already loading — joining that load`,
      );
      return inFlight;
    }
    const tracked: Promise<void> = this.runLoad(installPath, manifest).finally(
      () => {
        // Identity check for the same reason `pendingTeardowns` has one (3c-2b, M3):
        // a later load must not have its entry deleted by an earlier one finishing.
        if (this.inFlightLoads.get(manifest.id) === tracked) {
          this.inFlightLoads.delete(manifest.id);
        }
      },
    );
    this.inFlightLoads.set(manifest.id, tracked);
    return tracked;
  }

  /** Reload a plugin: clean unload (disposes subscriptions) then fresh load. */
  async reloadPlugin(
    installPath: string,
    manifest: PluginManifest,
  ): Promise<void> {
    await this.unloadPlugin(manifest.id);
    await this.loadPlugin(installPath, manifest);
  }

  /** Update the editor instance for plugin editor API */
  setEditor(editor: unknown): void {
    setEditorInstance(editor);
  }

  /**
   * Record why the Tiptap document is not the active tab's content (§260 Phase 4b
   * security review, LOW-3), or `null` when it is. Routed through the loader so the app
   * keeps ONE plugin-facing surface next to `setEditor`, rather than reaching into
   * `extension-context` from a component.
   */
  setEditorSurfaceBlocked(reason: null | string): void {
    recordEditorSurfaceBlocked(reason);
  }

  /** Unload all plugins (reverse order) */
  async unloadAll(): Promise<void> {
    const ids = [...this.loaded.keys()].reverse();
    for (const id of ids) {
      await this.unloadPlugin(id);
    }
  }

  /** Unload and deactivate a plugin */
  async unloadPlugin(id: string): Promise<void> {
    const plugin = this.loaded.get(id);
    if (!plugin) return;

    // Call deactivate
    if (typeof plugin.module.deactivate === "function") {
      try {
        await withTimeout(
          Promise.resolve(plugin.module.deactivate()),
          1000,
          `Plugin ${id} deactivation timed out`,
        );
      } catch (err) {
        logger.error(`[PluginLoader] Error deactivating ${id}:`, err);
      }
    }

    // Dispose all disposables
    for (const disposable of plugin.disposables) {
      try {
        disposable.dispose();
      } catch (e) {
        logger.error(`[PluginLoader] Dispose error:`, e);
      }
    }

    // §260 3c-2a review (I2) — sandbox teardown must be AWAITED, not fired off a
    // `Disposable` (whose `dispose(): void` cannot express async). A `deregister`
    // still in flight when the next `loadPlugin` runs — `reloadPlugin`, or a quick
    // disable/enable — would revoke the NEW registration, so the freshly booted
    // sandbox's `plugin_sandbox_connect` fails closed and activate times out; the
    // not-yet-closed webview would also collide on the `plugin-<id>` label.
    //
    // Bounded (3c-2a re-review N3): awaiting is the fix, but an unbounded await
    // would let one wedged IPC hang `unloadPlugin` → the sequential `unloadAll()`
    // → `shutdownPlugins()` on unmount, leaving every later plugin loaded. The old
    // fire-and-forget could not do that. On timeout the inner teardown keeps
    // running, so revocation still lands — just late enough that a reload inside
    // the window could race it, hence the loud log.
    if (plugin.teardown) {
      const failure = await this.runTrackedTeardown(id, plugin.teardown);
      if (failure) {
        // Make it VISIBLE (§260 3c-3 security review, M3). This is exactly where the
        // dangerous case lands: `plugin_sandbox_deregister` rejecting inside the
        // teardown's `finally` leaves the Rust grant REGISTERED while the lines below
        // forget the plugin entirely. Logging alone meant the user saw a clean disable
        // while an unsupervised sandbox kept its capabilities — the one path where that
        // can still happen. Rethrowing is not an option: `unloadAll()` is sequential, so
        // it would strand every later plugin (the bound that 3c-2a's N3 added exists for
        // that reason).
        usePluginStore
          .getState()
          .setError(
            id,
            `Teardown failed — this plugin may still hold its capabilities until ` +
              `restart: ${failure instanceof Error ? failure.message : String(failure)}`,
          );
      }
    }

    // Belt-and-suspenders: sweep any UI state the plugin left behind
    unregisterPluginUI(id);

    this.loaded.delete(id);
    logger.info(`[PluginLoader] Unloaded plugin: ${id}`);
  }

  /**
   * §260 — start a sandboxed plugin in a hidden `plugin-*` WebviewWindow and map
   * its declared commands onto the host command palette (each routed back to the
   * sandbox via `session.invokeCommand`). The plugin's own code never runs in the
   * main realm; storage/network reach the Rust broker (`plugin_call`) from inside
   * the sandbox, authorized by window label + capability.
   */
  private async loadSandboxedPlugin(
    installPath: string,
    manifest: PluginManifest,
  ): Promise<void> {
    // §260 3c-2b — a teardown from a previous load may still be in flight (its
    // `deregister` outlived `unloadPlugin`'s wait). Register only after it lands, or
    // it revokes the grant we are about to make and the new sandbox's connect fails
    // closed. Bounded: a permanently hung teardown degrades to the old racy
    // behaviour rather than blocking loads forever.
    const pending = this.pendingTeardowns.get(manifest.id);
    if (pending) {
      try {
        await withTimeout(
          pending,
          TEARDOWN_TIMEOUT,
          `Plugin ${manifest.id}: previous sandbox teardown is still in flight after ` +
            `${TEARDOWN_TIMEOUT}ms — loading anyway, which may race its revocation`,
        );
      } catch (e) {
        logger.error(`[PluginLoader] ${manifest.id}: teardown wait failed`, e);
      }
    }
    // §260 Phase 4a security review (HIGH-2) — this whole block is ONE unit of work,
    // because a throw partway used to leave the WORST possible state: the sandbox
    // running with its Rust grants, the webview holding its label, and NOTHING in
    // `this.loaded` — so `unloadPlugin` early-returned and the user disabling the plugin
    // was a no-op. A malformed `contributions.statusBar` entry was enough to reach it.
    // `disposables` is declared out here so the rollback can undo whatever landed;
    // `pluginSandboxRegister` is inside so the rollback's `deregister` covers it too
    // (that call is idempotent in Rust, so covering a grant that was never made is free).
    const disposables: Disposable[] = [];
    try {
      // Declared status-bar items go up FIRST, before any grant or webview exists
      // (code review M1). Four comments claimed the tier's items "appear before the
      // plugin's code runs" while the registration in fact sat after `start()`, which
      // awaits `activate` — up to 15s on a cold dev start, and never at all if activate
      // fails. Registering here makes the documented behaviour the real one, and the
      // rollback below removes them if the load does not complete.
      this.registerDeclaredStatusBar(manifest, disposables);
      // installPath goes to RUST, never to the sandbox: it binds which directory
      // `source_read` may read, so the executed bundle matches this manifest.
      await pluginSandboxRegister(
        manifest.id,
        manifest.capabilities,
        installPath,
      );
      // §260 3c-2b — no path is handed over: the sandbox pulls its own bundle
      // through the broker, resolved in Rust from its window label.
      const session = await this.sandboxHost.start(
        manifest.id,
        manifest.contributions ?? {},
        // §260 3c-2c — `ai` is mediated by the host, not brokered in Rust, because
        // its policy (privacy mode, model/provider for the task) is main-realm
        // state. The capability check lives in the handler and is enforcing: a
        // `plugin-*` window holds no `llm_*` ACL grant, so this is the only route
        // from the sandbox to a model.
        createHostRequestHandler({
          capabilities: manifest.capabilities,
          // §260 Phase 4a — `ui` rides the same mediated channel. The declared item ids
          // travel with it because the host, not the plugin, decides which items exist.
          declaredStatusBarIds: (manifest.contributions?.statusBar ?? []).map(
            (i) => i.id,
          ),
          // §260 Phase 4c — same rule for `settings`: WHICH fields exist is the host's
          // answer, from the manifest, so the frame carries no key or field list. Resolved
          // through `declaredSettingsFor`, which is also what the form uses, so a field the
          // plugin can read and a field the user can edit are the same set.
          declaredSettings: declaredSettingsFor(manifest),
          pluginId: manifest.id,
          pluginName: manifest.name,
        }),
      );
      this.wireSandboxContributions(manifest, session, disposables);
      this.loaded.set(manifest.id, {
        id: manifest.id,
        manifest,
        module: {},
        disposables,
        teardown: this.sandboxTeardown(manifest.id),
      });
    } catch (err) {
      // Roll back everything that landed, in the reverse order it landed, and revoke the
      // grant UNCONDITIONALLY (3c-2a re-review N2: revocation must not depend on the
      // teardown half succeeding — the worst case is a stop that failed *because* the
      // sandbox is alive). Never let a rollback failure mask the original error.
      // §260 Phase 4a code review (R1) — a FAILED revocation has to reach the user, and
      // `setError` cannot carry it: `initializePlugins` and `PluginMarketplace` both call
      // `setError(id, String(err))` immediately after this rejects, overwriting anything
      // written here. So it rides the thrown error instead. This is the one remaining path
      // where a live sandbox could keep its capabilities unreported — the exact state
      // HIGH-2 set out to eliminate.
      const revocation = await this.rollbackSandboxLoad(
        manifest.id,
        disposables,
      );
      if (revocation) throw withRevocationFailure(err, revocation);
      throw err;
    }
  }

  /**
   * §260 Phase 4a — declarative status bar, straight from the MANIFEST: no plugin code
   * has run when this happens, which is what lets an item show up while the sandbox is
   * still booting. Text is sanitised on the way in — it is author-controlled and reaches
   * the bar directly — and `command` becomes the full id the handler registry knows.
   *
   * Gated on `statusbar` (security review MEDIUM-3): updating an item already required
   * it, so creating one must too, or `capabilities: []` still buys space in the app
   * chrome — and declining the capability at Phase 5 would not take it away. Skipped with
   * a warning rather than failing the load: an ignored decoration should not stop a
   * plugin whose commands are fine.
   */
  private registerDeclaredStatusBar(
    manifest: PluginManifest,
    disposables: Disposable[],
  ): void {
    const declaredItems = manifest.contributions?.statusBar ?? [];
    if (declaredItems.length === 0) return;
    if (!manifest.capabilities.includes("statusbar")) {
      logger.warn(
        `[PluginLoader] ${manifest.id} declares statusBar items without the ` +
          `"statusbar" capability — ignoring them`,
      );
      return;
    }
    for (const item of declaredItems) {
      const itemId = statusBarItemId(manifest.id, item.id);
      usePluginUIStore.getState().registerStatusBarItem({
        align: "right",
        command: item.command ? `${manifest.id}.${item.command}` : undefined,
        itemId,
        // Not clickable until its handler exists (re-review LOW-5).
        pending: true,
        pluginId: manifest.id,
        text: sanitizeStatusBarText(item.text),
        tooltip: item.tooltip && sanitizeStatusBarText(item.tooltip),
      });
      disposables.push({
        dispose: () => usePluginUIStore.getState().removeStatusBarItem(itemId),
      });
    }
  }

  /**
   * Undo a partial sandboxed load: drop the UI it registered, stop the session, then
   * revoke its capabilities whatever happened.
   */
  private async rollbackSandboxLoad(
    id: string,
    disposables: Disposable[],
  ): Promise<Error | null> {
    for (const disposable of disposables.reverse()) {
      try {
        disposable.dispose();
      } catch (e) {
        logger.error(`[PluginLoader] rollback dispose error for ${id}:`, e);
      }
    }
    // Belt-and-suspenders for anything a disposable missed, matching `unloadPlugin`.
    // Guarded (re-review LOW-1): it was the one bare statement on this path, and it sits
    // BEFORE revocation — so a throw here would have skipped the revoke and replaced the
    // original error with its own.
    try {
      unregisterPluginUI(id);
    } catch (e) {
      logger.error(`[PluginLoader] rollback UI sweep failed for ${id}:`, e);
    }
    // The same bounded, tracked teardown `unloadPlugin` runs — not a second
    // stop-then-deregister written out by hand, which is how this path came to lack the
    // timeout the other one documents (re-review MEDIUM). Safe even when no session was
    // ever created: `SandboxHost.stop` returns early for an unknown id, and Rust's
    // `deregister` is a map removal, so revoking a grant that was never made is free.
    return this.runTrackedTeardown(id, this.sandboxTeardown(id));
  }

  private async runLoad(
    installPath: string,
    manifest: PluginManifest,
  ): Promise<void> {
    if (this.loaded.has(manifest.id)) {
      logger.warn(`[PluginLoader] Plugin ${manifest.id} is already loaded`);
      return;
    }

    // 1. Validate manifest
    const validation = validateManifest(manifest);
    if (!validation.valid) {
      throw new Error(
        `Invalid manifest for ${manifest.id}: ${validation.errors.map((e) => e.message).join(", ")}`,
      );
    }

    // §260 — route by trust tier. `validateManifest` above already rejects a
    // legacy (trust-less) manifest ("trust is required …"), which the install UI
    // surfaces for re-validation, so here trust is guaranteed "trusted" |
    // "sandboxed". `sandboxed` runs in an isolated webview via SandboxHost
    // (declarative contributions + brokered ops); `trusted` keeps the same-realm
    // path below.
    if (pluginTrustOf(manifest) === "sandboxed") {
      await this.loadSandboxedPlugin(installPath, manifest);
      logger.info(
        `[PluginLoader] Loaded sandboxed plugin: ${manifest.id} v${manifest.version}`,
      );
      return;
    }

    // 2. Construct asset URL for the main entry (cache-busted for reload)
    const mainPath = `${installPath}/${manifest.main}`;
    const assetUrl = `${convertFileSrc(mainPath)}?v=${++this.reloadCounter}`;

    // 3. Dynamic import (via injectable importer)
    let module: PluginModule;
    try {
      module = await this.importer(assetUrl);
    } catch (err) {
      throw new Error(`Failed to load plugin module ${manifest.id}: ${err}`, {
        cause: err,
      });
    }

    // 4. Create extension context
    const context = createExtensionContext(manifest, installPath);

    // 5. Activate with timeout
    if (typeof module.activate === "function") {
      await withTimeout(
        Promise.resolve(module.activate(context)),
        ACTIVATE_TIMEOUT,
        `Plugin ${manifest.id} activation timed out after ${ACTIVATE_TIMEOUT}ms`,
      );
    }

    // 6. Store loaded plugin
    this.loaded.set(manifest.id, {
      id: manifest.id,
      manifest,
      module,
      context,
      disposables: context.subscriptions,
    });

    logger.info(
      `[PluginLoader] Loaded plugin: ${manifest.id} v${manifest.version}`,
    );
  }

  /**
   * The teardown `unloadPlugin` awaits for a sandboxed plugin.
   *
   * Ordered: stop the session (closing the webview, which frees the `plugin-<id>`
   * label) BEFORE dropping the grant, so a subsequent load cannot race either.
   * Awaiting the deregister is what keeps it from landing after the next
   * `plugin_sandbox_register`.
   *
   * `finally` is load-bearing (3c-2a re-review N2): revocation is the
   * security-relevant half and must not be conditional on the teardown half
   * succeeding. A rejected `stop()` used to skip `deregister` entirely, leaving Rust
   * authorizing `plugin_call` for a plugin the loader had already forgotten — worst of
   * all when `stop()` failed *because* the webview is still alive. `stop()` is
   * separately bounded so a wedged window-close cannot swallow the whole teardown
   * budget before revocation gets its turn.
   *
   * BOUNDED (3c-2a re-review N3): an unbounded await lets one wedged IPC hang the caller.
   * For `unloadPlugin` that meant stranding every later plugin in `unloadAll()`; for the
   * load rollback it was worse (§260 Phase 4a security re-review, MEDIUM) — a hang is not
   * a rejection, so the `finally` that revokes the grant never ran, the rollback never
   * settled, and with it `inFlightLoads` never cleared and `initializePlugins` never
   * returned. `finally` buys unconditional-on-rejection, not unconditional-on-hang; only
   * a timeout buys that.
   *
   * TRACKED: on timeout the inner teardown keeps running, so its `deregister` can still
   * land AFTER the next load's `register` and revoke the fresh grant. `pendingTeardowns`
   * is what the next load waits on. The identity check before deleting is 3c-2b M3: two
   * concurrent teardowns for one id must not delete each other's entry.
   *
   * Returns the failure (for the caller to report as it sees fit) or `null`.
   */
  private async runTrackedTeardown(
    id: string,
    teardown: () => Promise<void>,
  ): Promise<Error | null> {
    const running = teardown();
    // `.catch` keeps the tracked copy from becoming an unhandled rejection — the real
    // error is returned to the caller.
    const tracked: Promise<void> = running
      .catch(() => {})
      .finally(() => {
        if (this.pendingTeardowns.get(id) === tracked) {
          this.pendingTeardowns.delete(id);
        }
      });
    this.pendingTeardowns.set(id, tracked);
    try {
      await withTimeout(
        running,
        TEARDOWN_TIMEOUT,
        `Plugin ${id} sandbox teardown timed out after ${TEARDOWN_TIMEOUT}ms — ` +
          `capability revocation is still in flight; the next load will wait for it`,
      );
      return null;
    } catch (e) {
      logger.error(`[PluginLoader] Sandbox teardown error for ${id}:`, e);
      // Normalised to an Error (code review R4): `Promise<null | unknown>` collapses to
      // `Promise<unknown>`, so the "null means success" discriminant this function
      // advertises would not have existed — and a falsy thrown value (`throw ""`) would
      // have read as success at every call site.
      return e instanceof Error ? e : new Error(String(e));
    }
  }

  private sandboxTeardown(id: string): () => Promise<void> {
    return async () => {
      try {
        await withTimeout(
          this.sandboxHost.stop(id),
          SANDBOX_STOP_TIMEOUT,
          `Sandbox stop for ${id} timed out after ${SANDBOX_STOP_TIMEOUT}ms`,
        );
      } catch (e) {
        // Logged HERE, not left to propagate: an exception from `finally` replaces the
        // one in flight, so if both halves fail only the deregister error would
        // surface — and a failed stop is the more alarming of the two, because it means
        // a live, still-capable sandbox.
        logger.error(`[PluginLoader] Sandbox stop failed for ${id}:`, e);
      } finally {
        await pluginSandboxDeregister(id);
      }
    };
  }

  /**
   * Map a started sandbox's declared commands onto the host and subscribe it to app
   * events. Everything it registers is pushed onto `disposables`, which is both the
   * unload path and the rollback path. (The status bar is registered earlier, before the
   * sandbox starts — see `registerDeclaredStatusBar`.)
   */
  private wireSandboxContributions(
    manifest: PluginManifest,
    session: SandboxSession,
    disposables: Disposable[],
  ): void {
    for (const cmd of session.contributions?.commands ?? []) {
      const fullId = `${manifest.id}.${cmd.id}`;
      // Always register the handler so a command can be invoked via menu or
      // programmatically; only surface it in the palette unless the manifest
      // opted out (palette: false) — mirrors the trusted path's visibility rule.
      disposables.push(
        registerHostCommandHandler(fullId, () => session.invokeCommand(cmd.id)),
      );
      if (cmd.palette !== false) {
        usePluginUIStore.getState().registerPaletteCommand({
          commandId: fullId,
          pluginId: manifest.id,
          title: cmd.title,
        });
        disposables.push({
          dispose: () =>
            usePluginUIStore.getState().removePaletteCommand(fullId),
        });
      }
    }
    // Handlers are registered: the declared items may be clicked (re-review LOW-5).
    usePluginUIStore.getState().markPluginCommandsReady(manifest.id);
    // §260 Phase 4a — from here the sandbox hears app events (`events`-gated inside the
    // bridge, which also strips absolute paths). Subscribing AFTER activate resolved is
    // deliberate: a frame delivered mid-activate would arrive before the plugin's
    // `events.on` had run and be dropped by its client.
    const subscriber = {
      capabilities: manifest.capabilities,
      pluginId: manifest.id,
      session,
    };
    disposables.push({ dispose: subscribeSandbox(subscriber) });
    // §260 Phase 4c — and to its OWN settings changing. Not part of the event bridge: that
    // one carries app events and gates them on `events`, while this is the settings feature
    // notifying its owner, gated on `settings` inside the watcher. Payload-free, so the
    // values still only ever travel as a staged pull.
    disposables.push({
      dispose: watchPluginSettings({
        capabilities: manifest.capabilities,
        pluginId: manifest.id,
        session,
      }),
    });
    // …and tell it what is already open, so its first useful moment does not depend on
    // the user switching tabs (the normal case at startup).
    replayCurrentState(subscriber, activeFilePath());
  }
}

/**
 * The file the user is looking at, or `null`. Read at load time only — live updates come
 * from `notifyFileOpen`, not from here.
 */
function activeFilePath(): null | string {
  const { activeTabId, tabs } = useEditorStore.getState();
  return tabs.find((t) => t.id === activeTabId)?.filePath ?? null;
}

/**
 * The load error, with a failed capability revocation appended.
 *
 * Keeps the original message as a PREFIX: it is what the user needs first, and callers
 * (and tests) match on it.
 */
function withRevocationFailure(original: unknown, failure: Error): Error {
  const base = original instanceof Error ? original.message : String(original);
  return new Error(
    `${base} — and revoking its capabilities did not complete: ${failure.message}. ` +
      `This plugin may keep its granted capabilities until the app restarts.`,
    { cause: original },
  );
}

/** Singleton instance */
export const pluginLoader = new PluginLoader();
