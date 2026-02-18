// §3.6 Auto-save hook — debounced write after last edit
import { useEffect, useRef, useCallback } from "react";
import type { Editor } from "@tiptap/core";
import { useEditorStore } from "../stores/editor-store";
import { useSettingsStore } from "../stores/settings-store";
import { prosemirrorToMarkdown } from "../pipeline";
import { writeFile, updateFileIndex } from "../ipc/invoke";

/**
 * Auto-save hook: 마지막 편집 후 설정된 딜레이(기본 2초) 뒤 자동 저장
 * §3.6: Debounced Write — 타이핑 중에는 저장하지 않음
 */
export function useAutoSave(editor: Editor | null) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { activeTabId, tabs, markDirty } = useEditorStore();
  const { autoSave, autoSaveDelay } = useSettingsStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);

  const save = useCallback(async () => {
    if (!editor || !activeTab || !activeTab.filePath) return;

    try {
      const markdown = prosemirrorToMarkdown(editor.state.doc);
      await writeFile(activeTab.filePath, markdown);
      markDirty(activeTab.id, false);
      updateFileIndex(activeTab.filePath).catch(() => {});
    } catch {
      // Save failed — keep dirty state, will retry on next edit
    }
  }, [editor, activeTab, markDirty]);

  useEffect(() => {
    if (!editor || !autoSave || !activeTab || !activeTab.filePath) return;

    const handleUpdate = () => {
      markDirty(activeTab.id, true);

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
  }, [editor, autoSave, autoSaveDelay, activeTab, markDirty, save]);

  return { save };
}
