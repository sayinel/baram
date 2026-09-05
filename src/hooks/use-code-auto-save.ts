// §82 Debounced auto-save for whatever the SOURCE BUFFER owns: non-markdown code
// files, and markdown while it is in source mode.
//
// ‼️ The markdown half is not an extension for its own sake. `use-auto-save` writes
// markdown from the Tiptap document on its `update` transactions — and in source mode
// that editor receives none, so markdown typed there had NO auto-save at all. The gap
// predates the source-edited flag; the flag only made it visible.
import { useEffect, useRef } from "react";

import { useShallow } from "zustand/shallow";

import { updateFileIndex, writeFile } from "../ipc/invoke";
import { useEditorStore } from "../stores/editor/editor";
import { useLinkStore } from "../stores/editor/link";
import { useSnapshotStore } from "../stores/editor/snapshot";
import { useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { isMarkdownFile } from "../utils/file-type";

export interface UseCodeAutoSaveOptions {
  /** §perf-large-file: bumps whenever the active tab's source buffer is
   * rewritten, so the debounce effect re-arms even when the tab id itself
   * didn't change. */
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

/** Auto-save for non-MD code files (debounced write when dirty). */
export function useCodeAutoSave({
  bufferVersion,
  getSourceBuffer,
  isEditableTextFile,
  markDirty,
  sourceModeTabs,
}: UseCodeAutoSaveOptions) {
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
    codeAutoSaveTimer.current = setTimeout(async () => {
      try {
        const content = getSourceBuffer(tab.id);
        await writeFile(tab.filePath!, content);
        useFileStore.getState().updateLastSaveMtime(tab.filePath!, Date.now());
        setFileContent(tab.filePath!, content);
        markDirty(tab.id, false);
        useEditorStore.getState().markSourceEdited(tab.id, false);
        // §71 Mark the auto-snapshot dirty gate for non-md/code file saves.
        useSnapshotStore.getState().markPendingAutoSnapshot();
        // Markdown carries links; leaving the index stale after an auto-save is
        // what `handleSave` already avoids on the manual path.
        if (markdownInSourceMode) {
          updateFileIndex(tab.filePath!)
            .then(() => useLinkStore.getState().invalidate())
            .catch(() => {});
        }
      } catch {
        // Save failed — keep dirty state
      }
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
}
