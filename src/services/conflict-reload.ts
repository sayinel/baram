// §3.6 The conflict modal's "Reload External Changes": put the file's current
// text into the conflicted tab, discarding that tab's unsaved work — and only
// that tab's.
//
// ‼️ The consent given here — drop this tab's local edits — is for one tab.
// The auto-reload cannot tell an unsaved edit from an edit the user just chose
// to discard — the buffers look the same — and inferring consent from `isDirty`
// would kill its guard (the modal only shows for tabs with unsaved work). So the
// consent is not carried into `triggerAutoReload` as a flag that works per path;
// it is spent here, on the tab the user was asked about, after the read is
// known to be current.
import type { ConflictEntry } from "../stores/ui/conflict-queue";
import type { ConflictFailure } from "./conflict-resolution";

import { useEditorStore } from "../stores/editor/editor";
import { useFileStore } from "../stores/file/file";
import { useUIStore } from "../stores/ui/ui";
import { readTabLocalText } from "../utils/editor/tab-local-text";
import { isBinaryViewerFile } from "../utils/file-type";
import { adoptable, adoptDiskTextIntoTab } from "./conflict-adopt";
import { beginOp, endOp, readSettled } from "./conflict-op";

/**
 * Read the file until the read is settled (`readSettled`), check nothing moved,
 * then — in one synchronous run — adopt it into the tab and acknowledge the
 * pending change.
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
    const read = await readSettled(op);
    if ("code" in read) return read;
    if (sharesPath(op.tabId, op.path)) {
      return { code: "unavailable", reason: "ambiguous" };
    }
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

    // The cutoff is when the accepted read started: a duplicate event of a
    // write that finished before it (macOS sends created + changed) is at or
    // below it; a write after it is above it and still shows up.
    const generation = ui().conflictGeneration(op.tabId);
    useFileStore.getState().updateLastSaveMtime(op.path, read.startedAt);
    useFileStore.getState().updateCanReloadMtime(op.path, 0);
    adoptDiskTextIntoTab(op.tabId, op.path, read.text);
    if (generation !== null) ui().resolveConflict(op.tabId, generation);
    return { code: "reloaded" };
  } finally {
    endOp(op);
  }
}

function sharesPath(tabId: string, path: string): boolean {
  return useEditorStore
    .getState()
    .tabs.some((t) => t.id !== tabId && t.filePath === path);
}
