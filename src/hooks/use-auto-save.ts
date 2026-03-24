// §3.6 Auto-save hook — debounced write after last edit
import { useCallback, useEffect, useRef } from "react";

import type { Editor } from "@tiptap/core";

import { useShallow } from "zustand/shallow";

import { updateFileIndex, writeFile } from "../ipc/invoke";
import { prosemirrorToMarkdown } from "../pipeline";
import { useEditorStore } from "../stores/editor/editor";
import { useLinkStore } from "../stores/editor/link";
import { useSettingsStore } from "../stores/settings/store";
import {
  isDocUnchanged,
  updateOriginalDoc,
} from "../utils/editor/programmatic-update";
import { isMarkdownFile } from "../utils/file-type";

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

    try {
      const markdown = prosemirrorToMarkdown(editor.state.doc);
      await writeFile(pending.filePath, markdown);
      markDirty(pending.id, false);
      // After save, current doc becomes the new baseline for dirty detection
      updateOriginalDoc(pending.id, editor.state.doc);
      updateFileIndex(pending.filePath)
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

      // Skip if doc hasn't actually changed from the loaded original.
      // This correctly handles: programmatic updateState (no change),
      // DOMObserver reconciliation (no change), AND roundtrip differences
      // (genuine change → dirty is correct).
      if (isDocUnchanged(tab.id, editor.state.doc)) return;

      markDirty(tab.id, true);
      // Record which tab triggered this save so save() can detect a mid-debounce tab switch
      pendingTabRef.current = { id: tab.id, filePath: tab.filePath };

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
