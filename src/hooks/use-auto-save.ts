// §3.6 Auto-save hook — debounced write after last edit
import { useCallback, useEffect, useRef } from "react";

import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

import { useShallow } from "zustand/shallow";

import { updateFileIndex, writeFile } from "../ipc/invoke";
import { prosemirrorToMarkdown } from "../pipeline";
import { useEditorStore } from "../stores/editor/editor";
import { useLinkStore } from "../stores/editor/link";
import { useSnapshotStore } from "../stores/editor/snapshot";
import { useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import {
  COLWIDTH_AUTO_INIT_META,
  JOURNAL_CURSOR_INIT_META,
  noteColwidthInit,
  shouldSkipDirty,
  updateOriginalDoc,
} from "../utils/editor/programmatic-update";
import { isMarkdownFile } from "../utils/file-type";
import { isJournalPath } from "../utils/journal/journal";
import { notifyJournalChanged } from "../utils/journal/journal-events";
import { logger } from "../utils/logger";

/**
 * Phase 4: Pure guard — returns true when auto-save should be deferred because an
 * external file:changed event has arrived that has not yet been resolved.
 *
 * Conditions for deferral (all must hold):
 *   1. An mtime entry exists for the file (file watcher has initialised tracking)
 *   2. canReloadMtime > 0  (at least one external change event received)
 *   3. canReloadMtime > lastSaveMtime  (external change is newer than last save)
 *
 * Exported for unit testing.
 */
export function shouldDeferSave(
  mtimeEntry: undefined | { canReloadMtime: number; lastSaveMtime: number },
): boolean {
  if (!mtimeEntry) return false;
  return (
    mtimeEntry.canReloadMtime > 0 &&
    mtimeEntry.canReloadMtime > mtimeEntry.lastSaveMtime
  );
}

/**
 * Auto-save hook: 마지막 편집 후 설정된 딜레이(기본 2초) 뒤 자동 저장
 * §3.6: Debounced Write — 타이핑 중에는 저장하지 않음
 * Note: Non-MD files are auto-saved by App.tsx directly; this hook only handles markdown.
 */

export function useAutoSave(editor: Editor | null) {
  const timerRef = useRef<null | ReturnType<typeof setTimeout>>(null);
  // Capture which tab scheduled the save; prevents writing tab B's content to tab A's
  // file when the user switches tabs during the debounce window.
  const pendingTabRef = useRef<null | { filePath: string; id: string }>(null);
  const { autoSave, autoSaveDelay } = useSettingsStore(
    useShallow((s) => ({
      autoSave: s.autoSave,
      autoSaveDelay: s.autoSaveDelay,
    })),
  );

  const save = useCallback(async () => {
    if (!editor) return;
    const pending = pendingTabRef.current;
    if (!pending) return;

    // Guard: if the active tab changed since the save was scheduled, editor.state.doc
    // now belongs to the new tab — writing it to pending.filePath would corrupt data.
    const { activeTabId, markDirty } = useEditorStore.getState();
    if (activeTabId !== pending.id) return;

    // Non-MD files don't use ProseMirror — skip (handled by App.tsx code auto-save)
    if (!isMarkdownFile(pending.filePath)) return;

    // Phase 4: mtime race-condition guard — if an external file:changed event has
    // arrived but not yet been resolved, skip this save so we don't overwrite the
    // external change without user consent.  The conflict handler (use-file-watcher)
    // will either auto-reload (clean) or show the conflict modal (dirty) and will
    // trigger a re-save once the user resolves the conflict.
    const mtimeEntry = useFileStore.getState().getFileMtime(pending.filePath);
    if (shouldDeferSave(mtimeEntry)) {
      logger.warn(
        "[auto-save] deferred: external change pending for",
        pending.filePath,
        `(canReloadMtime=${mtimeEntry!.canReloadMtime}, lastSaveMtime=${mtimeEntry!.lastSaveMtime})`,
      );
      return;
    }

    try {
      const markdown = prosemirrorToMarkdown(editor.state.doc);
      await writeFile(pending.filePath, markdown);
      markDirty(pending.id, false);
      // After save, current doc becomes the new baseline for dirty detection
      updateOriginalDoc(pending.id, editor.state.doc);
      // Phase 4: record save time so future mtime comparisons have a baseline
      useFileStore.getState().updateLastSaveMtime(pending.filePath, Date.now());
      // §56 If a journal entry's content changed, refresh the journal sidebars
      // (Memories One Line/Full) in real time instead of only on remount.
      if (
        isJournalPath(
          pending.filePath,
          useFileStore.getState().rootPath,
          useSettingsStore.getState().journalDirectory,
        )
      ) {
        notifyJournalChanged();
      }
      updateFileIndex(pending.filePath)
        .then(() => useLinkStore.getState().invalidate())
        .catch(() => {});
      // §71 Mark the auto-snapshot dirty gate — periodic snapshot hook only
      // snapshots when something actually changed since the last snapshot.
      useSnapshotStore.getState().markPendingAutoSnapshot();
    } catch {
      // Save failed — keep dirty state, will retry on next edit
    }
  }, [editor]);

  useEffect(() => {
    // NOTE: do NOT gate on `autoSave` here. Dirty tracking must run on every edit
    // regardless of the auto-save setting — otherwise the dirty indicator and the
    // external-change conflict detection silently break when auto-save is off.
    if (!editor) return;

    const handleUpdate = ({ transaction }: { transaction: Transaction }) => {
      // Read current tab at event time — avoids stale closure
      const { activeTabId, tabs, markDirty } = useEditorStore.getState();
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab?.filePath) return;

      // Auto-measured table colwidth init (createColResizePlugin) is load-time
      // normalization, not a user edit, and is never serialized (userResized:
      // false). Fold it into the dirty baseline so it never marks dirty nor
      // triggers a spurious auto-save on open. Without this, a multi-table file
      // lacking `<!-- colwidths -->` goes dirty on open: each table dispatches
      // its own colwidth tx and only the first is absorbed as the baseline.
      if (transaction?.getMeta(COLWIDTH_AUTO_INIT_META)) {
        noteColwidthInit(tab.id, editor.state.doc);
        return;
      }

      // Journal initial-caret placement (use-journal-initial-cursor.ts) inserts
      // an empty body paragraph below the date title. That paragraph is never
      // serialized to markdown, so — like colwidth init — fold it into the
      // dirty baseline instead of marking the just-opened journal dirty.
      if (transaction?.getMeta(JOURNAL_CURSOR_INIT_META)) {
        noteColwidthInit(tab.id, editor.state.doc);
        return;
      }

      // Skip if: (1) first update after content load (captures stable baseline),
      // or (2) doc unchanged from baseline. Only marks dirty for real changes.
      // For the first-update case, pass the pre-edit doc + a markdown comparator
      // so a genuine first edit (e.g. a media-block resize done as the first
      // action) is detected instead of being absorbed as the baseline. The
      // comparator only runs on that one update, never per-keystroke.
      if (
        shouldSkipDirty(tab.id, editor.state.doc, {
          beforeDoc: transaction.before,
          markdownEqual: (before, after) =>
            prosemirrorToMarkdown(before) === prosemirrorToMarkdown(after),
        })
      )
        return;

      markDirty(tab.id, true);
      // Record which tab triggered this save so save() can detect a mid-debounce tab switch
      pendingTabRef.current = { id: tab.id, filePath: tab.filePath };

      // Only schedule a debounced auto-save when the feature is enabled.
      if (!autoSave) return;

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => {
        save();
      }, autoSaveDelay);
    };

    editor.on("update", handleUpdate);

    return () => {
      editor.off("update", handleUpdate);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [editor, autoSave, autoSaveDelay, save]);

  return { save };
}
