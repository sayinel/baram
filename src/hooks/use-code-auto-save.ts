// §82 Debounced auto-save for whatever the SOURCE BUFFER owns: non-markdown code
// files, and markdown while it is in source mode.
//
// ‼️ The markdown half is not an extension for its own sake. `use-auto-save` writes
// markdown from the Tiptap document on its `update` transactions — and in source mode
// that editor receives none, so markdown typed there had NO auto-save at all. The gap
// predates the source-edited flag; the flag only made it visible.
//
// §392 spec 0071 §6.2 — a third way in: an editable plugin viewer's `markChanged`, through
// `rearmForViewerEdit`. A viewer change writes no buffer, so `bufferVersion`, which the effect
// below re-arms on, does not move.
//
// §392 spec 0071 D17 — the effect's timer and `rearmForViewerEdit`'s both write through
// `saveFromBuffer`, which lowers dirty only while the buffer still holds the text it wrote,
// code tabs included: text typed, or a viewer change taken by another read, while the write
// was in flight is not on disk.
//
// §3.5 (#798) Both timers are judged when they FIRE, against the tab as it is then: a tab
// closed while the timer waited is not written (its released buffer would read back as ""),
// and a renamed or moved tab is written under its current path, not the one it had when the
// timer was armed.
import { useCallback, useEffect, useRef } from "react";

import { useShallow } from "zustand/shallow";

import { writeFile } from "../ipc/invoke";
import { isFileTab, useEditorStore } from "../stores/editor/editor";
import { useSnapshotStore } from "../stores/editor/snapshot";
import { useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { asTabSave } from "../utils/editor/tab-save-in-flight";
import {
  isEditableTextPath,
  isMarkdownFile,
  isViewerEditableFile,
} from "../utils/file-type";

export interface UseCodeAutoSaveOptions {
  /**
   * §perf-large-file: bumps on every `setSourceBuffer`, whichever tab it writes (its one bump
   * site in `use-source-mode.ts`), so the debounce effect re-runs even when the active tab id
   * didn't change. A write to another tab's buffer re-runs it too, and §392 relies on that
   * (plan 0121 P4): the re-run arms the active tab's save, if that tab is unsaved, on the timer
   * a viewer re-arm shares.
   */
  bufferVersion: number;
  getSourceBuffer: (tabId: string) => string;
  isEditableTextFile: boolean;
  markDirty: (tabId: string, dirty: boolean) => void;
  /**
   * §287 소스 모드인 탭들. 마크다운은 **이 집합에 있을 때만** 여기서 저장한다 —
   * 그렇지 않으면 WYSIWYG을 소유한 `use-auto-save`와 같은 탭에 두 writer가 붙는다.
   */
  sourceModeTabs: ReadonlySet<string>;
}

/** What `useCodeAutoSave` hands App. */
export interface UseCodeAutoSaveReturn {
  /**
   * §392 spec 0071 §6.2 step 3 — re-arm the debounce from THIS call, for `tabId`'s editable
   * viewer. Renders nothing: the settings are read when it is called. It and the effect hold
   * one timer ref and each clears it before arming, so at most one save is scheduled at a time.
   * A call for a tab that is not the active one does nothing — this hook saves the active tab,
   * and clearing the shared timer for another tab would cancel the active tab's save. Its
   * identity changes only when one of the three functions it closes over does, not on a buffer
   * write.
   */
  rearmForViewerEdit: (tabId: string) => void;
}

/** What a save from the buffer needs from the hook — the same three for both ways in. */
interface BufferSaveDeps {
  getSourceBuffer: (tabId: string) => string;
  markDirty: (tabId: string, dirty: boolean) => void;
  setFileContent: (path: string, content: string) => void;
}

/** Auto-save for non-MD code files (debounced write when dirty). */
export function useCodeAutoSave({
  bufferVersion,
  getSourceBuffer,
  isEditableTextFile,
  markDirty,
  sourceModeTabs,
}: UseCodeAutoSaveOptions): UseCodeAutoSaveReturn {
  const { autoSave, autoSaveDelay } = useSettingsStore(
    useShallow((s) => ({
      autoSave: s.autoSave,
      autoSaveDelay: s.autoSaveDelay,
    })),
  );
  const setFileContent = useFileStore((s) => s.setFileContent);
  const codeAutoSaveTimer = useRef<null | ReturnType<typeof setTimeout>>(null);
  useEffect(() => {
    if (!autoSave) return;
    const {
      activeTabId: tabId,
      sourceEditedTabs,
      tabs: currentTabs,
    } = useEditorStore.getState();
    const tab = currentTabs.find((t) => t.id === tabId);
    if (!tab?.filePath) return;

    // ‼️ isEditableTextFile, not isCodeFile — the write below must never target a
    // binary file. See the definition for what went wrong when it did. Markdown is
    // the second door, and only while source mode owns the tab.
    const markdownInSourceMode =
      isMarkdownFile(tab.filePath) && sourceModeTabs.has(tab.id);
    if (!isEditableTextFile && !markdownInSourceMode) return;

    // Markdown source edits deliberately never raise `isDirty` (§312), so asking
    // `tab.isDirty` alone would skip exactly the case this branch exists for.
    const unsaved = tab.isDirty || sourceEditedTabs.includes(tab.id);
    if (!unsaved) return;

    if (codeAutoSaveTimer.current) clearTimeout(codeAutoSaveTimer.current);
    codeAutoSaveTimer.current = setTimeout(() => {
      void saveSourceTab(tab.id, {
        getSourceBuffer,
        markDirty,
        setFileContent,
      });
    }, autoSaveDelay);

    return () => {
      if (codeAutoSaveTimer.current) clearTimeout(codeAutoSaveTimer.current);
    };
  }, [
    isEditableTextFile,
    sourceModeTabs,
    autoSave,
    autoSaveDelay,
    bufferVersion,
    markDirty,
    setFileContent,
    getSourceBuffer,
  ]);

  const rearmForViewerEdit = useCallback(
    (tabId: string) => {
      const { autoSave: enabled, autoSaveDelay: delay } =
        useSettingsStore.getState();
      if (!enabled) return;
      // Before the clear below: that clear would cancel a save the effect armed for the
      // active tab.
      if (tabId !== useEditorStore.getState().activeTabId) return;
      if (codeAutoSaveTimer.current) clearTimeout(codeAutoSaveTimer.current);
      codeAutoSaveTimer.current = setTimeout(() => {
        void saveViewerTab(tabId, {
          getSourceBuffer,
          markDirty,
          setFileContent,
        });
      }, delay);
    },
    [getSourceBuffer, markDirty, setFileContent],
  );

  // §392 — the effect above clears the shared timer in its cleanup only when its last run armed
  // it, so a timer `rearmForViewerEdit` armed after a run that returned early has no cleanup.
  // This one clears it when the hook unmounts.
  useEffect(
    () => () => {
      if (codeAutoSaveTimer.current) clearTimeout(codeAutoSaveTimer.current);
    },
    [],
  );

  return { rearmForViewerEdit };
}

/**
 * The one save sequence both timers here run — the effect's, through `saveSourceTab`, and the one
 * `rearmForViewerEdit` arms through `saveViewerTab` — so a change to it reaches both: read the
 * buffer, write it, then record the save.
 *
 * - The save's mtime is recorded while the tab still shows `filePath`; the write was ours.
 * - The content, dirty and the source-edited flag are recorded only while the buffer still holds
 *   what was written (spec 0071 D17, and #798 for the cache and the source-edited flag): text
 *   typed, or a viewer change taken by another read, while the write ran is not on disk, and a
 *   markdown tab in source mode keeps its unsaved state in the source-edited flag, not in dirty.
 * - §29 #824 — a markdown file is in the link index once `writeFile` resolves; nothing here
 *   updates the index or invalidates the link store.
 *
 * A failed write keeps the dirty state.
 */
async function saveFromBuffer(
  tabId: string,
  filePath: string,
  deps: BufferSaveDeps,
): Promise<void> {
  try {
    const content = deps.getSourceBuffer(tabId);
    const savedAt = await asTabSave(filePath, tabId, () =>
      writeFile(filePath, content),
    );
    const stillShown = useEditorStore
      .getState()
      .tabs.some((t) => t.id === tabId && t.filePath === filePath);
    if (stillShown) {
      useFileStore
        .getState()
        .updateLastSaveMtime(filePath, savedAt ?? Date.now());
    }
    // The read takes a viewer change still pending, so that is compared too (§392 D17).
    if (stillShown && deps.getSourceBuffer(tabId) === content) {
      deps.setFileContent(filePath, content);
      deps.markDirty(tabId, false);
      useEditorStore.getState().markSourceEdited(tabId, false);
    }
    // §71 Mark the auto-snapshot dirty gate for non-md/code file saves.
    useSnapshotStore.getState().markPendingAutoSnapshot();
  } catch {
    // Save failed — keep dirty state
  }
}

/**
 * The write the effect schedules, judged when it fires (#798): the tab still exists, and its
 * CURRENT path still belongs to this writer — an editable text file, or markdown while that tab
 * is in source mode. A rename or move while the timer waited is written under the new path; a
 * rename to a markdown name outside source mode leaves the file to the WYSIWYG document.
 */
async function saveSourceTab(
  tabId: string,
  deps: BufferSaveDeps,
): Promise<void> {
  const { sourceModeTabs, tabs } = useEditorStore.getState();
  const tab = tabs.find((t) => t.id === tabId);
  if (!tab?.filePath) return;
  const path = tab.filePath;
  const sourceMarkdown = isMarkdownFile(path) && sourceModeTabs.includes(tabId);
  if (!isEditableTextPath(path) && !sourceMarkdown) return;
  await saveFromBuffer(tabId, path, deps);
}

/**
 * The write `rearmForViewerEdit` schedules, judged when it fires rather than when it was armed:
 * the tab is still the active one, still a file tab, still a file a viewer may edit
 * (`isViewerEditableFile`), and still dirty. Only the active tab is saved here (spec 0071 §8:
 * a dirty tab sent to the background is saved, as a code tab is, when it is active again or on
 * close or quit). Dirty is enough to tell whether there is anything to save (spec §6.2 step 3):
 * while the viewer holds a change no read has taken, D15 keeps the tab dirty, and a change
 * another read took while a save from the buffer was writing is kept dirty by that save's D17
 * comparison (the five such saves are listed in plan 0121 P17).
 */
async function saveViewerTab(
  tabId: string,
  deps: BufferSaveDeps,
): Promise<void> {
  const { activeTabId, tabs } = useEditorStore.getState();
  const tab = tabs.find((t) => t.id === tabId);
  if (tabId !== activeTabId || !isFileTab(tab) || !tab.isDirty) return;
  if (!isViewerEditableFile(tab.filePath)) return;
  await saveFromBuffer(tabId, tab.filePath, deps);
}
