// §3.6 Auto-save hook — debounced write after last edit
import { useCallback, useEffect, useRef } from "react";

import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

import { useShallow } from "zustand/shallow";

import { updateFileIndex, writeFile } from "../ipc/invoke";
import { isFileTab, useEditorStore } from "../stores/editor/editor";
import { useLinkStore } from "../stores/editor/link";
import { useSnapshotStore } from "../stores/editor/snapshot";
import { useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import {
  COLWIDTH_AUTO_INIT_META,
  CONTENT_SYNC_META,
  isTabLoading,
  JOURNAL_CURSOR_INIT_META,
  loadedTabId,
  noteColwidthInit,
  noteContentSync,
  shouldSkipDirty,
  subscribeContentLoaded,
  updateOriginalDoc,
} from "../utils/editor/programmatic-update";
import {
  documentSaveOutcome,
  saveSource,
  tabStillShows,
  textSaveOutcome,
} from "../utils/editor/save-still-current";
import {
  serializeDetachedDoc,
  serializeLiveDoc,
} from "../utils/editor/serialize-live-doc";
import { isEphemeralOnlyUpdate } from "../utils/editor/syntax-reveal-ephemeral";
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
 * Whether the document would serialize to nothing. `editor.isEmpty` alone is not that: it reads a
 * callout with only a title as empty, and the title is text someone wrote. It comes first because
 * this runs on every edit of an untitled tab, and it answers no for any tab with text in it.
 */
function holdsNothing(editor: Editor): boolean {
  return editor.isEmpty && serializeLiveDoc(editor).trim() === "";
}

/**
 * Starts `tabId`'s debounce over, leaving every other tab's alone. When it ends the tab is saved; a
 * save that finds the tab still loading is put in `waitingForLoad`, and `useAutoSave` starts it
 * again once the tab's document is installed.
 */
function armSave(
  timers: Map<string, ReturnType<typeof setTimeout>>,
  waitingForLoad: Set<string>,
  editor: Editor,
  tabId: string,
  delay: number,
): void {
  clearTimeout(timers.get(tabId));
  timers.set(
    tabId,
    setTimeout(() => {
      timers.delete(tabId);
      void saveTab(editor, tabId).then((result) => {
        if (result === "waitForLoad") waitingForLoad.add(tabId);
      });
    }, delay),
  );
}

/**
 * Writes `tabId`'s text to the tab's file, read from wherever that text is when the save runs
 * (`saveSource`) — the tab may have been left, or come back, since its save was scheduled. Records
 * the save only for what the tab still holds once the write has ended (#798).
 *
 * @returns `"waitForLoad"` when the tab's document is still loading and nothing was written
 */
async function saveTab(
  editor: Editor,
  tabId: string,
): Promise<"waitForLoad" | null> {
  const { markDirty, sourceModeTabs, tabs } = useEditorStore.getState();
  // §3.5 경로는 예약할 때가 아니라 지금의 탭에서 읽는다(#798). 기다리는 사이 rename · move
  // 되었으면 예약할 때의 경로에 쓰는 것은 옛 파일을 되살리는 것이다. 닫힌 탭은 경로가 없다.
  const filePath = tabs.find((t) => t.id === tabId)?.filePath;
  if (!filePath) return null;

  // A timer armed before source mode began. The buffer is this tab's text now. It is written by
  // `use-code-auto-save`, which armed its own save for an unsaved tab on the way in, or on the way
  // back by `handBufferToDocument` if the tab returns before that. The document is still what it
  // was: written here, it would put older text on disk and lower the mark, so a close before
  // those saves would lose what was typed there.
  if (sourceModeTabs.includes(tabId)) return null;

  // Non-MD files don't use ProseMirror — skip (handled by App.tsx code auto-save)
  if (!isMarkdownFile(filePath)) return null;

  // A tab still loading — a document longer than its first chunk, coming back with no cached state
  // (its keep-alive editor evicted, its cache dropped as stale or by a global reload) or leaving
  // source mode — holds only its first blocks, and typing into them marks nothing dirty. The save
  // runs again when the tab's document is installed (`useAutoSave`). A tab left before its load ends
  // is installed only when it comes back; until then the close guard asks about it.
  if (isTabLoading(tabId)) return "waitForLoad";

  // `null`: nothing of this tab may be written now (`saveSource` lists when). The tab stays dirty.
  const source = saveSource(editor, tabId, filePath);
  if (!source) return null;

  // Phase 4: mtime race-condition guard — if an external file:changed event has
  // arrived but not yet been resolved, skip this save so we don't overwrite the
  // external change without user consent.  The conflict handler (use-file-watcher)
  // will either auto-reload (clean) or show the conflict modal (dirty) and will
  // trigger a re-save once the user resolves the conflict.
  const mtimeEntry = useFileStore.getState().getFileMtime(filePath);
  if (shouldDeferSave(mtimeEntry)) {
    logger.warn(
      "[auto-save] deferred: external change pending for",
      filePath,
      `(canReloadMtime=${mtimeEntry!.canReloadMtime}, lastSaveMtime=${mtimeEntry!.lastSaveMtime})`,
    );
    return null;
  }

  try {
    const markdown =
      source.kind === "document" ? source.serialize() : source.text;
    await writeFile(filePath, markdown);
    // §3.5 쓰는 사이 탭이 닫혔거나 다른 경로로 옮겨졌으면 저장 결과를 탭의 기록에 남기지 않는다
    // (#798). 남기면 닫힌 파일의 원문 · 수정 시각이 되살아나고, 그 사이 같은 파일을 새 탭으로 다시
    // 열었다면 그 탭이 읽은 내용을 이 저장의 옛 내용으로 덮는다. 디스크와 index 갱신은 그대로 한다.
    const stillShown = tabStillShows(tabId, filePath);
    if (stillShown) {
      // Phase 4: record save time so future mtime comparisons have a baseline — this
      // write is ours whatever happened to the document since.
      useFileStore.getState().updateLastSaveMtime(filePath, Date.now());
    }
    const { baseline, cacheIsDisk, unchanged } =
      source.kind === "document"
        ? documentSaveOutcome(source.judge, tabId, source.doc, markdown)
        : textSaveOutcome(editor, tabId, filePath, markdown);
    // §312 ‼️ 방금 쓴 내용이 곧 그 파일의 새 기준선이다. 이것을 빠뜨리면 자동 저장
    // 한 번마다 `openFiles`가 낡고(자동 저장은 기본값이 켜짐이다), 그 캐시를 기준선으로
    // 쓰는 자동 리로드의 갈라짐 판정(use-file-operations.ts의 `syncSourceBuffers`)이
    // 멀쩡한 버퍼를 "갈라졌다"고 오판해 외부 변경을 화면에 반영하지 않는다 — 그러면서
    // `lastSaveMtime`은 올라가므로 다음 저장이 그 외부 변경을 디스크에서 지운다.
    // 그 캐시를 읽는 읽기 전용 패널들(PropertiesPanel·Skill 미리보기)도 함께 낫는다.
    // 쓰는 사이 더 친 글이 있어도 그렇다. 다만 쓰는 사이 공유 편집기가 떠난 탭이면 캐시는 그 탭의
    // 글이라 바꾸지 않는다(#798, `SaveOutcome.cacheIsDisk`).
    if (stillShown && cacheIsDisk) {
      useFileStore.getState().setFileContent(filePath, markdown);
    }
    // §3.5 쓰는 사이 사용자가 더 고쳤으면 "저장됨" 을 기록하지 않는다 — 그 편집은 파일에 없다.
    if (stillShown && unchanged) {
      markDirty(tabId, false);
      // The document the tab holds now becomes the new baseline for dirty detection: the written
      // one, or one a change the dirty tracking folds landed in during the write. A tab that still holds
      // only its text has none to take; its install takes the baseline (`markContentLoaded`).
      if (baseline) updateOriginalDoc(tabId, baseline);
    }
    // §56 If a journal entry's content changed, refresh the journal sidebars
    // (Memories One Line/Full) in real time instead of only on remount.
    if (
      isJournalPath(
        filePath,
        useFileStore.getState().rootPath,
        useSettingsStore.getState().journalDirectory,
      )
    ) {
      notifyJournalChanged();
    }
    updateFileIndex(filePath)
      .then(() => useLinkStore.getState().invalidate())
      .catch(() => {});
    // §71 Mark the auto-snapshot dirty gate — periodic snapshot hook only
    // snapshots when something actually changed since the last snapshot.
    useSnapshotStore.getState().markPendingAutoSnapshot();
  } catch {
    // Save failed — keep dirty state, will retry on next edit
  }
  return null;
}

/**
 * Auto-save hook: 마지막 편집 후 설정된 딜레이(기본 2초) 뒤 자동 저장
 * §3.6: Debounced Write — 타이핑 중에는 저장하지 않음
 * Note: Non-MD files are auto-saved by App.tsx directly; this hook only handles markdown.
 *
 * §3.6 ‼️ 디바운스는 탭마다 하나다. 예전에는 타이머 하나가 "예약한 탭이 지금도 활성이면" 만
 * 썼으므로, 편집하고 지연 안에 다른 탭으로 옮기면 그 탭의 저장이 버려졌다 — 타이머가 울릴 때 활성
 * 검사에서, 활성 편집기가 바뀌면(keep-alive 편집기로, 또는 거기서) 이 effect 의 cleanup 에서, 옮긴 탭에서 바로
 * 편집하면 그 탭이 예약 자리를 덮어써서. 탭은 dirty 로 남고 파일은 옛 내용 그대로였다. 이제 탭을
 * 떠나도 그 탭의 타이머는 남고, 울릴 때 그 탭의 문서가 있는 곳에서 쓴다(`saveTab`).
 */
export function useAutoSave(editor: Editor | null) {
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const waitingForLoadRef = useRef(new Set<string>());
  const { autoSave, autoSaveDelay } = useSettingsStore(
    useShallow((s) => ({
      autoSave: s.autoSave,
      autoSaveDelay: s.autoSaveDelay,
    })),
  );

  /** Runs every waiting save now, instead of at the end of its debounce. */
  const save = useCallback(async () => {
    if (!editor) return;
    const timers = timersRef.current;
    const waiting = [...timers.keys()];
    for (const tabId of waiting) clearTimeout(timers.get(tabId));
    timers.clear();
    for (const tabId of waiting) {
      if ((await saveTab(editor, tabId)) === "waitForLoad") {
        waitingForLoadRef.current.add(tabId);
      }
    }
  }, [editor]);

  useEffect(() => {
    // NOTE: do NOT gate on `autoSave` here. Dirty tracking must run on every edit
    // regardless of the auto-save setting — otherwise the dirty indicator and the
    // external-change conflict detection silently break when auto-save is off.
    if (!editor) return;

    const handleUpdate = ({
      transaction,
      appendedTransactions,
    }: {
      appendedTransactions: Transaction[];
      transaction: Transaction;
    }) => {
      // Read current tab at event time — avoids stale closure
      const { activeTabId, sourceModeTabs, tabs, markDirty } =
        useEditorStore.getState();
      const tab = tabs.find((t) => t.id === activeTabId);
      // The document of a tab in source mode is out of sight and not what gets saved, so a change
      // to it (an AI chat Apply) is not unsaved work, and nothing would ever lower this mark.
      if (activeTabId && sourceModeTabs.includes(activeTabId)) return;
      // ‼️ Asked as "is this a file?", not "does it have a path?". An untitled tab has none, and
      // its text is what the unsaved-changes prompts exist for. Only the write below needs a path.
      if (!isFileTab(tab)) return;
      // The active tab flips before the next document is installed, so in that gap an update
      // belongs to the tab being left. A tab with a path has its save to lower a wrong mark; an
      // untitled one has nothing, so it would ask about text it never held.
      if (!tab.filePath && loadedTabId() !== tab.id) return;

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

      // §384 (C): syntax-reveal expand/collapse changes the doc's
      // REPRESENTATION (delimiters ⇄ marks/nodes) without changing what it
      // serializes to — e.g. the caret walking into then back out of a link.
      // Treat an update whose every doc-changing transaction (primary +
      // appended, see isEphemeralOnlyUpdate) is ephemeral-tagged as a no-op
      // for dirty/auto-save, same intent as the load-time/programmatic folds
      // below — but WITHOUT touching the baseline: a completed
      // expand→collapse round trip restores the identical doc structure the
      // baseline already holds (the link/media attr-stash fix keeps it
      // lossless), so there is nothing to fold in.
      if (isEphemeralOnlyUpdate({ transaction, appendedTransactions })) return;

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
      const unchanged = shouldSkipDirty(tab.id, editor.state.doc, {
        beforeDoc: transaction.before,
        markdownEqual: (before, after) =>
          serializeDetachedDoc(before) === serializeDetachedDoc(after),
      });

      // An untitled tab has no file to differ from and no save to lower its mark, so the mark is
      // simply whether it holds anything. Asked of the document, not of the baseline: restoring
      // the tab makes its text the baseline, so "same as the baseline" would read a draft brought
      // back by an undo as clean.
      if (!tab.filePath) {
        if (!isTabLoading(tab.id)) markDirty(tab.id, !holdsNothing(editor));
        return;
      }
      if (unchanged) return;

      markDirty(tab.id, true);

      // Only schedule a debounced auto-save when the feature is enabled.
      if (!autoSave) return;

      armSave(
        timersRef.current,
        waitingForLoadRef.current,
        editor,
        tab.id,
        autoSaveDelay,
      );
    };

    editor.on("update", handleUpdate);

    // ‼️ Only the listener goes. A tab switch that changes the active editor (to or from a keep-alive
    // editor) re-runs this effect, and a waiting save cleared here was a tab's edit never written.
    return () => {
      editor.off("update", handleUpdate);
    };
  }, [editor, autoSave, autoSaveDelay]);

  // A save that found its tab still loading starts again when the load ends in an install
  // (`markContentLoaded`, after `setTabLoading(…, false)`).
  useEffect(() => {
    if (!editor || !autoSave) return;
    const timers = timersRef.current;
    const waitingForLoad = waitingForLoadRef.current;
    return subscribeContentLoaded((tabId) => {
      if (!waitingForLoad.delete(tabId)) return;
      armSave(timers, waitingForLoad, editor, tabId, autoSaveDelay);
    });
  }, [editor, autoSave, autoSaveDelay]);

  // Waiting saves go when auto-save is turned off, and when the hook unmounts.
  useEffect(() => {
    if (!autoSave) return;
    const timers = timersRef.current;
    const waitingForLoad = waitingForLoadRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      waitingForLoad.clear();
    };
  }, [autoSave]);

  return { save };
}
