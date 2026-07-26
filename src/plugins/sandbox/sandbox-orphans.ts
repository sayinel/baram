// §260 Phase 3c-3 — close sandbox webviews that outlived the realm that owned them.
//
// FOUND BY THE LIVE SMOKE: re-adding a dev plugin failed with
// `a webview with label "plugin-baram-sandbox-smoke" already exists`.
//
// A `plugin-*` WebviewWindow is owned by Tauri (Rust), not by the main window's JS
// realm, and the authorizer grant + inbound channel are app-global managed state. So
// when the main realm reloads — Vite HMR in dev, a manual refresh, any remount —
// `SandboxHost.live` and `PluginLoader.loaded` reset to empty while:
//
//   • the plugin's webview keeps RUNNING (hidden window, timers alive), and
//   • Rust still authorizes its `plugin_call`s and still accepts its reports.
//
// That is worse than the visible symptom: an unsupervised sandbox with its
// capabilities intact can keep reading vault files and using the network proxy, with
// no session watching and nothing left in the UI that knows it exists. Nothing in the
// app closed it, so the state could only diverge further.
//
// Sweeping at startup is the recovery, and it must both CLOSE and REVOKE: closing
// stops the code, revoking stops what the code was allowed to ask for.
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";

import { pluginSandboxDeregister } from "../../ipc/plugin-invoke";
import { logger } from "../../utils/logger";

/** The label prefix Rust derives identity from (`plugin_id_from_label`). */
const SANDBOX_LABEL_PREFIX = "plugin-";

export interface OrphanSweepDeps {
  deregister?: (pluginId: string) => Promise<void>;
  listWindows?: () => Promise<SweepableWindow[]>;
}

/** Just enough of a webview to identify and close it, so tests need no Tauri. */
export interface SweepableWindow {
  close: () => Promise<void>;
  label: string;
}

/**
 * Close and revoke every live `plugin-*` webview. Returns the plugin ids handled.
 *
 * Call before loading anything: a stale grant for an id about to be re-registered
 * would otherwise be revoked by nothing, and the label would still be taken.
 */
export async function closeOrphanSandboxWebviews(
  deps: OrphanSweepDeps = {},
): Promise<string[]> {
  const listWindows = deps.listWindows ?? defaultListWindows;
  // Wrapped rather than referenced: touching the imported binding here would resolve
  // it on EVERY call, including the common no-orphan case, which also made the sweep
  // depend on the IPC module being fully available in tests that partially mock it.
  const deregister =
    deps.deregister ?? ((id: string) => pluginSandboxDeregister(id));

  let windows: SweepableWindow[];
  try {
    windows = await listWindows();
  } catch (err) {
    // Never let the sweep break startup — the worst case without it is the label
    // collision that led here, which is loud and recoverable by restarting.
    logger.error(
      "[Sandbox] could not enumerate windows for orphan sweep:",
      err,
    );
    return [];
  }

  const orphans = windows.filter((w) =>
    w.label.startsWith(SANDBOX_LABEL_PREFIX),
  );
  const handled: string[] = [];
  for (const orphan of orphans) {
    const pluginId = orphan.label.slice(SANDBOX_LABEL_PREFIX.length);
    // Close first, revoke second — the same ordering `unloadPlugin`'s teardown uses:
    // stop the code before dropping what it may ask for. `finally` because revocation
    // is the security-relevant half and must not depend on the close succeeding
    // (§260 3c-2a re-review, N2).
    try {
      await orphan.close();
    } catch (err) {
      logger.error(`[Sandbox] failed to close orphan ${orphan.label}:`, err);
    } finally {
      try {
        await deregister(pluginId);
        handled.push(pluginId);
      } catch (err) {
        logger.error(`[Sandbox] failed to revoke orphan ${pluginId}:`, err);
      }
    }
  }
  if (handled.length > 0) {
    logger.warn(
      `[Sandbox] closed ${handled.length} orphaned sandbox webview(s) left by a ` +
        `previous realm: ${handled.join(", ")}`,
    );
  }
  return handled;
}

async function defaultListWindows(): Promise<SweepableWindow[]> {
  const { getAllWebviewWindows } =
    await import("@tauri-apps/api/webviewWindow");
  const windows: WebviewWindow[] = await getAllWebviewWindows();
  return windows.map((w) => ({ close: () => w.close(), label: w.label }));
}
