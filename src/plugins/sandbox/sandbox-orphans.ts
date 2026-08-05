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
// no session watching and nothing left in the UI that knows it exists.
//
// Sweeping at startup is the recovery, and it must both CLOSE and REVOKE: closing
// stops the code, revoking stops what the code was allowed to ask for.
//
// ‼️ It must also leave ALONE anything the CURRENT realm owns (§260 3c-3 code review,
// HIGH-1). The sweep sees only labels; a live session and an orphan look identical
// from here, so the caller passes the ids it is tracking. Without that, any second
// call — `React.StrictMode` double-invoking the mount effect is the everyday one —
// closes and revokes the sandboxes the first call just started.
import type { WebviewWindow } from "@tauri-apps/api/webviewWindow";

import { pluginSandboxDeregister } from "../../ipc/plugin-invoke";
import { logger } from "../../utils/logger";

/** The label prefix Rust derives identity from (`plugin_id_from_label`). */
const SANDBOX_LABEL_PREFIX = "plugin-";

export interface OrphanSweepDeps {
  deregister?: (pluginId: string) => Promise<void>;
  listWindows?: () => Promise<SweepableWindow[]>;
  /**
   * Plugin ids this realm is running or starting. Never swept — they are supervised,
   * so closing them would break a working plugin rather than recover a leaked one.
   */
  ownedIds?: Iterable<string>;
}

/**
 * What the sweep did. Separate lists (§260 3c-3 code review, M5) because the two
 * halves fail independently: a webview that refuses to close can still have its
 * capabilities revoked, which is the outcome that matters most.
 */
export interface OrphanSweepResult {
  closed: string[];
  revoked: string[];
  skipped: string[];
}

/** Just enough of a webview to identify and close it, so tests need no Tauri. */
export interface SweepableWindow {
  close: () => Promise<void>;
  label: string;
}

/**
 * Close and revoke every `plugin-*` webview this realm does NOT own.
 *
 * Call before loading anything: a stale grant for an id about to be re-registered
 * would otherwise be revoked by nothing, and the label would still be taken.
 */
export async function closeOrphanSandboxWebviews(
  deps: OrphanSweepDeps = {},
): Promise<OrphanSweepResult> {
  const listWindows = deps.listWindows ?? defaultListWindows;
  const deregister = deps.deregister ?? pluginSandboxDeregister;
  const owned = new Set(deps.ownedIds ?? []);
  const result: OrphanSweepResult = { closed: [], revoked: [], skipped: [] };

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
    return result;
  }

  for (const window of windows) {
    if (!window.label.startsWith(SANDBOX_LABEL_PREFIX)) continue;
    const pluginId = window.label.slice(SANDBOX_LABEL_PREFIX.length);
    if (owned.has(pluginId)) {
      result.skipped.push(pluginId);
      continue;
    }
    // Close first, revoke second — the same ordering `unloadPlugin`'s teardown uses:
    // stop the code before dropping what it may ask for. Both are attempted even if
    // the first fails, because revocation is the security-relevant half and an
    // orphan that cannot be closed is exactly the one that must not keep its grants.
    try {
      await window.close();
      result.closed.push(pluginId);
    } catch (err) {
      logger.error(`[Sandbox] failed to close orphan ${window.label}:`, err);
    }
    try {
      await deregister(pluginId);
      result.revoked.push(pluginId);
    } catch (err) {
      logger.error(`[Sandbox] failed to revoke orphan ${pluginId}:`, err);
    }
  }

  if (result.closed.length > 0 || result.revoked.length > 0) {
    logger.warn(
      `[Sandbox] orphaned sandbox webviews left by a previous realm — closed ` +
        `${result.closed.length}, revoked ${result.revoked.length}` +
        (result.skipped.length > 0
          ? `, left ${result.skipped.length} live one(s) alone`
          : ""),
    );
  }
  return result;
}

async function defaultListWindows(): Promise<SweepableWindow[]> {
  const { getAllWebviewWindows } =
    await import("@tauri-apps/api/webviewWindow");
  const windows: WebviewWindow[] = await getAllWebviewWindows();
  return windows.map((w) => ({ close: () => w.close(), label: w.label }));
}
