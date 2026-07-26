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
import { logger } from "../utils/logger";
import {
  createExtensionContext,
  registerHostCommandHandler,
  setEditorInstance,
  unregisterPluginUI,
} from "./extension-context";
import { validateManifest } from "./manifest";
import { pluginTrustOf } from "./plugin-trust";
import { usePluginUIStore } from "./plugin-ui-store";
import { arePluginsEnabled, isSandboxRuntimeAllowed } from "./plugins-enabled";
import { createHostRequestHandler } from "./sandbox/host-ai-bridge";
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

  /** Load and activate a single plugin */
  async loadPlugin(
    installPath: string,
    manifest: PluginManifest,
  ): Promise<void> {
    // §259 — final choke point: never load/execute plugin code unless the build
    // explicitly opts in. Guards every load path (startup, dev reload, install),
    // regardless of how the caller was reached.
    if (!arePluginsEnabled()) {
      throw new Error(
        "Plugins are disabled in this build for security (see #259/#260).",
      );
    }

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
      // Track the UN-timed-out promise: after the timeout below the teardown is
      // still running, and the next load has to wait for it (see
      // `loadSandboxedPlugin`) or its `deregister` lands after the new register and
      // revokes the fresh grant. `.catch` keeps the tracked copy from becoming an
      // unhandled rejection — the real error is reported here.
      const running = plugin.teardown();
      // Identity check before deleting (§260 3c-2b review, M3): `unloadPlugin` only
      // removes from `this.loaded` at the very end, so two concurrent calls for the
      // same id both start a teardown. Without this, whichever finishes first would
      // delete the OTHER one's entry and the next load would stop waiting —
      // resurrecting the exact race this map exists to prevent.
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
      } catch (e) {
        logger.error(`[PluginLoader] Sandbox teardown error for ${id}:`, e);
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
    // Belt-and-suspenders over arePluginsEnabled: never create a sandbox webview
    // in a packaged build (release gate lifts in Phase 5).
    if (!isSandboxRuntimeAllowed()) {
      throw new Error(
        `Plugin ${manifest.id}: sandbox runtime is gated off in this build (#260 Phase 5).`,
      );
    }
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
    // installPath goes to RUST, never to the sandbox: it binds which directory
    // `source_read` may read, so the executed bundle matches this manifest.
    await pluginSandboxRegister(
      manifest.id,
      manifest.capabilities,
      installPath,
    );
    let session: SandboxSession;
    try {
      // §260 3c-2b — no path is handed over: the sandbox pulls its own bundle
      // through the broker, resolved in Rust from its window label.
      session = await this.sandboxHost.start(
        manifest.id,
        manifest.contributions ?? {},
        // §260 3c-2c — `ai` is mediated by the host, not brokered in Rust, because
        // its policy (privacy mode, model/provider for the task) is main-realm
        // state. The capability check lives in the handler and is enforcing: a
        // `plugin-*` window holds no `llm_*` ACL grant, so this is the only route
        // from the sandbox to a model.
        createHostRequestHandler({
          capabilities: manifest.capabilities,
          pluginId: manifest.id,
        }),
      );
    } catch (err) {
      // roll back the capability grant if the sandbox failed to start; never let a
      // deregister failure mask the original start error.
      try {
        await pluginSandboxDeregister(manifest.id);
      } catch (deregErr) {
        logger.error(
          `[PluginLoader] rollback deregister failed for ${manifest.id}:`,
          deregErr,
        );
      }
      throw err;
    }

    const disposables: Disposable[] = [];
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
    this.loaded.set(manifest.id, {
      id: manifest.id,
      manifest,
      module: {},
      disposables,
      // Ordered and awaited by `unloadPlugin`: stop the session (closing the
      // webview, which frees the `plugin-<id>` label) BEFORE dropping the grant, so
      // a subsequent load cannot race either. Awaiting the deregister is what keeps
      // it from landing after the next `plugin_sandbox_register`.
      //
      // `finally` is load-bearing (3c-2a re-review N2): revocation is the
      // security-relevant half and must not be conditional on the teardown half
      // succeeding. A rejected `stop()` used to skip `deregister` entirely, leaving
      // Rust authorizing `plugin_call` for a plugin the loader had already forgotten
      // — worst of all when `stop()` failed *because* the webview is still alive.
      // `stop()` is separately bounded so a wedged window-close cannot swallow the
      // whole teardown budget before revocation gets its turn.
      teardown: async () => {
        try {
          await withTimeout(
            this.sandboxHost.stop(manifest.id),
            SANDBOX_STOP_TIMEOUT,
            `Sandbox stop for ${manifest.id} timed out after ${SANDBOX_STOP_TIMEOUT}ms`,
          );
        } catch (e) {
          // Logged HERE, not left to propagate: an exception from `finally`
          // replaces the one in flight, so if both halves fail only the
          // deregister error would surface — and a failed stop is the more
          // alarming of the two, because it means a live, still-capable sandbox.
          logger.error(
            `[PluginLoader] Sandbox stop failed for ${manifest.id}:`,
            e,
          );
        } finally {
          await pluginSandboxDeregister(manifest.id);
        }
      },
    });
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Singleton instance */
export const pluginLoader = new PluginLoader();
