// §3.6 Auto-save hook — debounced write after last edit
import { useCallback, useEffect, useRef } from "react";

import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

import { useShallow } from "zustand/shallow";

import { updateFileIndex, writeFile } from "../ipc/invoke";
import { useEditorStore } from "../stores/editor/editor";
import { useLinkStore } from "../stores/editor/link";
import { useSnapshotStore } from "../stores/editor/snapshot";
import { useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import {
  COLWIDTH_AUTO_INIT_META,
  CONTENT_SYNC_META,
  JOURNAL_CURSOR_INIT_META,
  noteColwidthInit,
  noteContentSync,
  shouldSkipDirty,
  updateOriginalDoc,
} from "../utils/editor/programmatic-update";
import {
  serializeDetachedDoc,
  serializeLiveDoc,
} from "../utils/editor/serialize-live-doc";
import { isBinaryViewerFile, isMarkdownFile } from "../utils/file-type";
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
      const markdown = serializeLiveDoc(editor);
      await writeFile(pending.filePath, markdown);
      // §312 ‼️ 방금 쓴 내용이 곧 그 파일의 새 기준선이다. 이것을 빠뜨리면 자동 저장
      // 한 번마다 `openFiles`가 낡고(자동 저장은 기본값이 켜짐이다), 그 캐시를 기준선으로
      // 쓰는 자동 리로드의 갈라짐 판정(use-file-operations.ts의 `syncSourceBuffers`)이
      // 멀쩡한 버퍼를 "갈라졌다"고 오판해 외부 변경을 화면에 반영하지 않는다 — 그러면서
      // `lastSaveMtime`은 올라가므로 다음 저장이 그 외부 변경을 디스크에서 지운다.
      // 그 캐시를 읽는 읽기 전용 패널들(PropertiesPanel·Skill 미리보기)도 함께 낫는다.
      useFileStore.getState().setFileContent(pending.filePath, markdown);
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

      // ‼️ The active tab is read at EVENT TIME, so a transaction that belongs to the
      // markdown document can land on whatever tab is active by the time it fires. Open
      // a PDF and that is the PDF's tab: it goes dirty without anyone editing anything,
      // and closing it asks whether to save.
      //
      // The dirty flag is not cosmetic here. App.tsx's non-markdown auto-save effect is
      // gated on `isCodeFile` — which is merely "not markdown", so a PDF qualifies — and
      // fires when the tab is dirty, writing `sourceContentRef.current` over the file.
      // With `autoSave` defaulting to true, a PDF marked dirty is a PDF about to be
      // overwritten with text.
      //
      // A binary file cannot be edited through this editor, so a dirty signal attributed
      // to one is spurious by construction. This is the rule file-type.ts already states:
      // every text path must skip these files.
      if (isBinaryViewerFile(tab.filePath)) return;

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

      // §313 A programmatic sync (patchEditorContent) brings the document in line with
      // what the file ALREADY says — an in-app write the user made from a panel, or a
      // reload of this app's own write. Marking it dirty would put an unsaved dot on a
      // change that is saved and, with auto-save on, write the same bytes back. Fold it
      // into the baseline instead, exactly as the two load-time inits above are.
      if (transaction?.getMeta(CONTENT_SYNC_META)) {
        noteContentSync(tab.id, editor.state.doc);
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
            serializeDetachedDoc(before) === serializeDetachedDoc(after),
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
