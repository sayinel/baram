// §3.6 The conflict modal's side of the app: keeps queued conflicts pointed at
// their tabs as tabs are renamed and closed.
import { useEffect } from "react";

import type { EditorTab } from "../../stores/editor/editor";

import { isTabUnsaved, useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useUIStore } from "../../stores/ui/ui";

/**
 * Bring the conflict queue in line with the tab list.
 *
 * 1. A tab whose path changed (rename, move): its entry follows it, so the modal
 *    names the file the tab now shows.
 * 2. A tab that is gone: its entry is dropped. Reopening the path makes a tab
 *    with a new id, which never inherits the old conflict.
 * 3. For each dropped path no other entry and no unsaved open tab still claims,
 *    the pending external change is acknowledged (`canReloadMtime = 0`). The
 *    guard would otherwise hold the WYSIWYG auto-save of the reopened file
 *    forever; reopening reads the disk, so the change it guarded is on screen.
 */
export function syncConflictTargets(tabs: readonly EditorTab[]): void {
  const ui = useUIStore.getState();
  const byId = new Map(tabs.map((t) => [t.id, t]));
  for (const entry of ui.conflictQueue) {
    const tab = byId.get(entry.tabId);
    if (tab && tab.filePath !== entry.filePath) {
      ui.retargetConflict(entry.tabId, tab.filePath);
    }
  }
  const gone = useUIStore
    .getState()
    .conflictQueue.filter((e) => !byId.has(e.tabId));
  for (const entry of gone) ui.dropConflict(entry.tabId);

  const { sourceEditedTabs } = useEditorStore.getState();
  const remaining = useUIStore.getState().conflictQueue;
  for (const path of new Set(gone.map((e) => e.filePath))) {
    const stillClaimed =
      remaining.some((e) => e.filePath === path) ||
      tabs.some(
        (t) => t.filePath === path && isTabUnsaved(t, sourceEditedTabs),
      );
    if (!stillClaimed) useFileStore.getState().updateCanReloadMtime(path, 0);
  }
}

/**
 * Follow the tab list synchronously — a store subscription, not a render
 * effect, so a rename and a close that land in one render are seen one by one
 * and a closed tab's entry is acknowledged under the path it last had.
 */
export function useConflictTargetSync(): void {
  useEffect(
    () =>
      useEditorStore.subscribe((state, prev) => {
        if (state.tabs !== prev.tabs) syncConflictTargets(state.tabs);
      }),
    [],
  );
}
