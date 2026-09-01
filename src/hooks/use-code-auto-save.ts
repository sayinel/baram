// Auto-save for non-MD code files (debounced write when dirty)
import { useEffect, useRef } from "react";

import { useShallow } from "zustand/shallow";

import { writeFile } from "../ipc/invoke";
import { useEditorStore } from "../stores/editor/editor";
import { useSnapshotStore } from "../stores/editor/snapshot";
import { useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";

export interface UseCodeAutoSaveOptions {
  /** §perf-large-file: bumps whenever the active tab's source buffer is
   * rewritten, so the debounce effect re-arms even when the tab id itself
   * didn't change. */
  bufferVersion: number;
  getSourceBuffer: (tabId: string) => string;
  isEditableTextFile: boolean;
  markDirty: (tabId: string, dirty: boolean) => void;
}

/** Auto-save for non-MD code files (debounced write when dirty). */
export function useCodeAutoSave({
  bufferVersion,
  getSourceBuffer,
  isEditableTextFile,
  markDirty,
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
    // ‼️ isEditableTextFile, not isCodeFile — the write below must never target a
    // binary file. See the definition for what went wrong when it did.
    if (!isEditableTextFile || !autoSave) return;
    const { activeTabId: tabId, tabs: currentTabs } = useEditorStore.getState();
    const tab = currentTabs.find((t) => t.id === tabId);
    if (!tab?.isDirty || !tab.filePath) return;

    if (codeAutoSaveTimer.current) clearTimeout(codeAutoSaveTimer.current);
    codeAutoSaveTimer.current = setTimeout(async () => {
      try {
        const content = getSourceBuffer(tab.id);
        await writeFile(tab.filePath!, content);
        useFileStore.getState().updateLastSaveMtime(tab.filePath!, Date.now());
        setFileContent(tab.filePath!, content);
        markDirty(tab.id, false);
        // §71 Mark the auto-snapshot dirty gate for non-md/code file saves.
        useSnapshotStore.getState().markPendingAutoSnapshot();
      } catch {
        // Save failed — keep dirty state
      }
    }, autoSaveDelay);

    return () => {
      if (codeAutoSaveTimer.current) clearTimeout(codeAutoSaveTimer.current);
    };
  }, [
    isEditableTextFile,
    autoSave,
    autoSaveDelay,
    bufferVersion,
    markDirty,
    setFileContent,
    getSourceBuffer,
  ]);
}
