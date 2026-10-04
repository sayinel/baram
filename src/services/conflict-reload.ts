// §3.6 The conflict modal's "Reload External Changes": put the file's current
// text into the conflicted tab, discarding that tab's unsaved work — and only
// that tab's.
//
// ‼️ This is the one place where "the user agreed to drop local edits" exists.
// The auto-reload cannot tell an unsaved edit from an edit the user just chose
// to discard — the buffers look the same — and inferring consent from `isDirty`
// would kill its guard (the modal only shows for tabs with unsaved work). So the
// consent is not carried into `triggerAutoReload` as a flag that works per path;
// it is spent here, on the tab the user was asked about, after the read is
// known to be current.
import type { ConflictEntry } from "../stores/ui/conflict-queue";
import type { ConflictFailure } from "./conflict-resolution";

import { readFile } from "../ipc/invoke";
import { useEditorStore } from "../stores/editor/editor";
import { useFileStore } from "../stores/file/file";
import { useUIStore } from "../stores/ui/ui";
import { readTabLocalText } from "../utils/editor/tab-local-text";
import { isBinaryViewerFile } from "../utils/file-type";
import { adoptable, adoptDiskTextIntoTab } from "./conflict-adopt";
import { beginOp, endOp, liveness } from "./conflict-op";

const READ_ATTEMPTS = 3;

/**
 * Read the file, check nothing moved while it was read, then — in one
 * synchronous run — adopt it into the tab and acknowledge the pending change.
 *
 * Refused when another tab holds the same path: `openFiles`, the mtimes and the
 * disk are per path, so a per-tab reload is undefined there; closing the other
 * tab is the way out. A binary viewer is not read (its cache holds a "" sentinel,
 * and the mtime bump refreshes the viewer), as in `triggerAutoReload`.
 */
export async function reloadForConflict(
  entry: ConflictEntry,
): Promise<ConflictFailure | { code: "reloaded" }> {
  const op = beginOp(entry.tabId, "reload");
  if (typeof op === "string") return { code: op };
  try {
    if (sharesPath(op.tabId, op.path)) {
      return { code: "unavailable", reason: "ambiguous" };
    }
    const ui = useUIStore.getState;
    if (isBinaryViewerFile(op.path)) {
      const generation = ui().conflictGeneration(op.tabId);
      useEditorStore.getState().markDirty(op.tabId, false);
      useEditorStore.getState().markSourceEdited(op.tabId, false);
      useFileStore.getState().updateLastSaveMtime(op.path, Date.now());
      useFileStore.getState().updateCanReloadMtime(op.path, 0);
      if (generation !== null) ui().resolveConflict(op.tabId, generation);
      return { code: "reloaded" };
    }

    // The consent was given for THIS text; text typed after it is not covered.
    const before = readTabLocalText(op.tabId);
    for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
      const readStartedAt = Date.now();
      const g0 = ui().conflictGeneration(op.tabId);
      let fresh: string;
      try {
        fresh = await readFile(op.path);
      } catch {
        return { code: "read-failed" };
      }
      const gone = liveness(op);
      if (gone) return { code: gone };
      if (sharesPath(op.tabId, op.path)) {
        return { code: "unavailable", reason: "ambiguous" };
      }
      // An event that arrived during the read may postdate it; read again.
      if (ui().conflictGeneration(op.tabId) !== g0) continue;
      if (!adoptable(op.tabId)) {
        return { code: "unavailable", reason: "loading" };
      }
      const now = readTabLocalText(op.tabId);
      if (
        before.kind === "text" &&
        (now.kind !== "text" || now.text !== before.text)
      ) {
        return { code: "local-changed" };
      }

      // The cutoff is when the read started: a duplicate event of a write that
      // finished before the read (macOS sends created + changed) is at or
      // below it; a write after the read is above it and still shows up.
      useFileStore.getState().updateLastSaveMtime(op.path, readStartedAt);
      useFileStore.getState().updateCanReloadMtime(op.path, 0);
      adoptDiskTextIntoTab(op.tabId, op.path, fresh);
      if (g0 !== null) ui().resolveConflict(op.tabId, g0);
      return { code: "reloaded" };
    }
    return { code: "unstable" };
  } finally {
    endOp(op);
  }
}

function sharesPath(tabId: string, path: string): boolean {
  return useEditorStore
    .getState()
    .tabs.some((t) => t.id !== tabId && t.filePath === path);
}
