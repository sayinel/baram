// §3.6 The bookkeeping that follows a tab's write to disk, split in two so the
// writers that use it (`handleSave`, the conflict actions) keep one order: note
// the write (snapshot gate, echo cutoff), update the cache and the tab's flags
// (the caller's part), then announce it (plugins, journal sidebars, link index).
// For those writers, plugins hear `file:save` after the cache and the flags say
// the file is saved.
import { updateFileIndex } from "../ipc/invoke";
import { notifyFileSave } from "../plugins/plugin-lifecycle";
import { useLinkStore } from "../stores/editor/link";
import { useSnapshotStore } from "../stores/editor/snapshot";
import { useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { isJournalPath } from "../utils/journal/journal";
import { notifyJournalChanged } from "../utils/journal/journal-events";

/** Tell plugins, the journal sidebars and (for markdown) the link index. */
export function announceTabWrite(
  path: string,
  { indexLinks }: { indexLinks: boolean },
): void {
  notifyFileSave(path);
  // §56 Refresh journal sidebars in real time on a save.
  if (
    isJournalPath(
      path,
      useFileStore.getState().rootPath,
      useSettingsStore.getState().journalDirectory,
    )
  ) {
    notifyJournalChanged();
  }
  if (indexLinks) {
    updateFileIndex(path)
      .then(() => useLinkStore.getState().invalidate())
      .catch(() => {});
  }
}

/**
 * Record that the app wrote `path` at `savedAt`: arm the auto-snapshot gate (§71)
 * and move the echo cutoff (`lastSaveMtime`) so the watcher drops our own write.
 */
export function noteTabWritten(path: string, savedAt: number): void {
  useSnapshotStore.getState().markPendingAutoSnapshot();
  useFileStore.getState().updateLastSaveMtime(path, savedAt);
}
