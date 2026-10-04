// §3.6 The conflict modal's side of the app: runs the actions against the
// conflicted tab, owns the merge view's state, turns result codes into toasts,
// and keeps queued conflicts pointed at their tabs as tabs are renamed and closed.
import { useCallback, useEffect, useState } from "react";

import type { Locale } from "../../i18n";
import type {
  ConflictFailure,
  PreparedMerge,
} from "../../services/conflict-resolution";
import type { EditorTab } from "../../stores/editor/editor";
import type { ConflictEntry } from "../../stores/ui/conflict-queue";

import { t } from "../../i18n";
import { reloadForConflict } from "../../services/conflict-reload";
import {
  applyConflictMerge,
  CONFLICT_RESULT_KEYS,
  CONFLICT_UNAVAILABLE_KEYS,
  keepLocalForConflict,
  prepareConflictMerge,
} from "../../services/conflict-resolution";
import { isTabUnsaved, useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { basename } from "../../utils/path-utils";

export interface ConflictActions {
  /** The merge view's data, or null when it is closed. */
  merge: null | PreparedMerge;
  /** Apply is running: the merge view's buttons are disabled. */
  mergeBusy: boolean;
  onApply: (merged: string) => void;
  onCancelMerge: () => void;
  onKeepLocal: (entry: ConflictEntry) => void;
  onMerge: (entry: ConflictEntry) => void;
  onReload: (entry: ConflictEntry) => void;
  /** An action started from the modal is running: its buttons are disabled. */
  pending: boolean;
}

/**
 * Tell the user why an action stopped. Silent for `busy` (a second press) and
 * `tab-gone` (nothing left to talk about). Names the tab's current file.
 */
export function toastConflictFailure(
  failure: ConflictFailure,
  tabId: string,
): void {
  if (failure.code === "busy" || failure.code === "tab-gone") return;
  const key =
    failure.code === "unavailable"
      ? CONFLICT_UNAVAILABLE_KEYS[failure.reason]
      : CONFLICT_RESULT_KEYS[failure.code];
  const tab = useEditorStore.getState().tabs.find((x) => x.id === tabId);
  const { locale } = useSettingsStore.getState();
  useUIStore
    .getState()
    .showToast(
      t(key, locale as Locale, { name: basename(tab?.filePath ?? "") }),
      "warning",
    );
}

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

/**
 * The conflict modal's actions and the merge view's state. Every action runs
 * against the entry's tab (`conflict-resolution.ts`) and leaves the conflict
 * queued unless it succeeded — Cancel included.
 */
export function useConflictActions(): ConflictActions {
  useConflictTargetSync();
  const [merge, setMerge] = useState<null | PreparedMerge>(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [pending, setPending] = useState(false);

  const onMerge = useCallback((entry: ConflictEntry) => {
    setPending(true);
    void prepareConflictMerge(entry).then((result) => {
      setPending(false);
      if (result.code === "prepared") setMerge(result.prepared);
      else toastConflictFailure(result, entry.tabId);
    });
  }, []);

  const onApply = useCallback(
    (merged: string) => {
      if (!merge) return;
      setMergeBusy(true);
      void applyConflictMerge(merge, merged).then((result) => {
        setMergeBusy(false);
        if (result.code === "busy") return;
        // A failed write keeps the merge open to try again; any other stop
        // closes it, and the modal asks again with what is true now.
        if (result.code !== "write-failed") setMerge(null);
        if (result.code !== "applied") {
          toastConflictFailure(result, merge.tabId);
        }
      });
    },
    [merge],
  );

  const onCancelMerge = useCallback(() => setMerge(null), []);

  const onKeepLocal = useCallback((entry: ConflictEntry) => {
    setPending(true);
    void keepLocalForConflict(entry).then((result) => {
      setPending(false);
      if (result.code !== "saved") toastConflictFailure(result, entry.tabId);
    });
  }, []);

  const onReload = useCallback((entry: ConflictEntry) => {
    setPending(true);
    void reloadForConflict(entry).then((result) => {
      setPending(false);
      if (result.code !== "reloaded") {
        toastConflictFailure(result, entry.tabId);
        return;
      }
      const tab = useEditorStore
        .getState()
        .tabs.find((x) => x.id === entry.tabId);
      // Same message as the auto-reload's (`triggerAutoReload`).
      useUIStore
        .getState()
        .showToast(
          `Reloaded external changes: ${basename(tab?.filePath ?? "")}`,
        );
    });
  }, []);

  return {
    merge,
    mergeBusy,
    onApply,
    onCancelMerge,
    onKeepLocal,
    onMerge,
    onReload,
    pending,
  };
}
