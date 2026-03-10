// §3.6 Auto-save hook — debounced write after last edit
import { useCallback, useEffect, useRef } from "react";

import type { Editor } from "@tiptap/core";

import { updateFileIndex, writeFile } from "../ipc/invoke";
import { prosemirrorToMarkdown } from "../pipeline";
import { useEditorStore } from "../stores/editor-store";
import { useLinkStore } from "../stores/link-store";
import { useSettingsStore } from "../stores/settings-store";
import { isMarkdownFile } from "../utils/file-type";

/**
 * Auto-save hook: 마지막 편집 후 설정된 딜레이(기본 2초) 뒤 자동 저장
 * §3.6: Debounced Write — 타이핑 중에는 저장하지 않음
 * Note: Non-MD files are auto-saved by App.tsx directly; this hook only handles markdown.
 */
export function useAutoSave(editor: Editor | null) {
  const timerRef = useRef<null | ReturnType<typeof setTimeout>>(null);
  const { autoSave, autoSaveDelay } = useSettingsStore();

  const save = useCallback(async () => {
    if (!editor) return;
    // Read current tab from store at save time — avoids stale closure
    const { activeTabId, tabs, markDirty } = useEditorStore.getState();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || !tab.filePath) return;
    // Non-MD files don't use ProseMirror — skip (handled by App.tsx code auto-save)
    if (!isMarkdownFile(tab.filePath)) return;

    try {
      const markdown = prosemirrorToMarkdown(editor.state.doc);
      await writeFile(tab.filePath, markdown);
      markDirty(tab.id, false);
      updateFileIndex(tab.filePath)
        .then(() => useLinkStore.getState().invalidate())
        .catch(() => {});
    } catch {
      // Save failed — keep dirty state, will retry on next edit
    }
  }, [editor]);

  useEffect(() => {
    if (!editor || !autoSave) return;

    const handleUpdate = () => {
      // Read current tab at event time — avoids stale closure
      const { activeTabId, tabs, markDirty } = useEditorStore.getState();
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab?.filePath) return;

      markDirty(tab.id, true);

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
