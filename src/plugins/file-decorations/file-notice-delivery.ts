// §395 spec 0074 D11 · §5.4 — `file:rename` and `file:delete` to the plugins that may hear them. The shape
// of `vault-change-notifier.ts`: WHO may hear — `files` or `files:readonly`, the capabilities of the paths
// a notice names, not `events` — is decided here for both tiers (`watchFileNotices`); only the delivery
// differs: the trusted tier's own bus with absolute paths (`emitFileNotice`), the sandboxed tier's frame
// with paths relative to a context (`deliverFileNoticeToSandbox`). Not through the event bridge
// (`sandbox/sandbox-event-bridge.ts`), which requires `events`, and so not in `PluginEventName`, which
// keys that bridge's payloads.
import type { PluginCapability } from "../types";
import type { FileNotice } from "./operation-notices";

import { logger } from "../../utils/logger";
import { locateInContext } from "../locate-in-context";
import { canHearVaultChanges } from "../vault-change-notifier";
import { onFileNotice } from "./operation-notices";

export const FILE_DELETE_EVENT = "file:delete";
export const FILE_RENAME_EVENT = "file:rename";

export interface WatchFileNoticesOptions {
  capabilities: readonly PluginCapability[];
  /** Tier-specific: a frame to the sandbox, or this plugin's own handlers in this realm. */
  deliver: (notice: FileNotice) => void;
  /** Names the tier in the debug log. */
  label: string;
  pluginId: string;
  /** Injectable for tests; defaults to the app's notices. */
  subscribe?: (listener: (notice: FileNotice) => void) => () => void;
}

/**
 * D11 — the sandboxed delivery. Both paths are made relative to a context (`locateInContext`); a notice
 * is not sent when either is in no registered context. There is no size bound (spec 0074 D11 after
 * dev-notes `240ed96`): the ORDER of a notice and the `vault:changed` after it does not depend on size,
 * because the host sends a sandbox's frames one at a time (`sandbox/send-chain.ts`) and tauri 2.12.2's
 * channel numbers each frame, which the sandbox's `Channel` (@tauri-apps/api 2.12.4) hands over in that
 * order (plan 0127 P21).
 */
export function deliverFileNoticeToSandbox(
  deliverEvent: (event: string, args: unknown[]) => void,
  notice: FileNotice,
): void {
  const event = sandboxNoticeEvent(notice);
  if (event === null) return;
  deliverEvent(event.event, event.args);
}

/** D11 — the trusted delivery on `emit` (the plugin's own bus): absolute paths, then `isDir`. */
export function emitFileNotice(
  emit: (event: string, ...args: unknown[]) => void,
  notice: FileNotice,
): void {
  if (notice.kind === "rename") {
    emit(FILE_RENAME_EVENT, notice.from, notice.to, notice.isDir);
  } else {
    emit(FILE_DELETE_EVENT, notice.path, notice.isDir);
  }
}

/**
 * D11 — the sandboxed event for `notice` (`PluginFileRename` / `PluginFileDelete`), or `null` when a path
 * is in no registered context. A rename's sides are located apart, so a move between nested vaults carries
 * two contexts.
 */
export function sandboxNoticeEvent(
  notice: FileNotice,
): null | { args: unknown[]; event: string } {
  if (notice.kind === "delete") {
    const at = locateInContext(notice.path);
    return at === null
      ? null
      : { args: [{ ...at, isDir: notice.isDir }], event: FILE_DELETE_EVENT };
  }
  const from = locateInContext(notice.from);
  const to = locateInContext(notice.to);
  return from === null || to === null
    ? null
    : { args: [{ from, isDir: notice.isDir, to }], event: FILE_RENAME_EVENT };
}

/**
 * Tell one plugin about the app's renames and deletions; returns an unsubscriber. A plugin without a file
 * capability is not subscribed at all — its `on("file:rename")` is accepted and never fires.
 */
export function watchFileNotices(options: WatchFileNoticesOptions): () => void {
  const { capabilities, deliver, label, pluginId } = options;
  if (!canHearVaultChanges(capabilities)) return () => undefined;
  const subscribe = options.subscribe ?? onFileNotice;
  return subscribe((notice) => {
    try {
      deliver(notice);
    } catch (err) {
      // A closed session is the ordinary case: a notice that races an unload.
      logger.debug(`[${label}] ${pluginId}: file notice skipped`, err);
    }
  });
}
