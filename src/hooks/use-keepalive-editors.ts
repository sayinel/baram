// §perf-large-file C3.5: keep-alive editor pool state — owns the pooled
// editor(s) for large documents and the "which editor is active" derivation
// the rest of App reads (`activeEditor`).
import { useCallback, useEffect, useRef, useState } from "react";

import type { Editor } from "@tiptap/react";

import { pluginLoader } from "../plugins/plugin-loader";
import {
  type KeepalivePool,
  useLargeDocKeepalive,
} from "./use-large-doc-keepalive";

interface UseKeepaliveEditorsReturn {
  activeEditor: Editor | null;
  activeKeepaliveEditor: Editor | null;
  keepalive: KeepalivePool;
  mountedKeepaliveEditor: Editor | null;
  onActiveEditorChange: (e: Editor | null) => void;
}

export function useKeepaliveEditors(
  editor: Editor | null,
): UseKeepaliveEditorsReturn {
  // mountedKeepaliveEditor: the editor whose EditorContent is mounted (stays
  // mounted as long as it's in the pool — this is the "keep-alive" part).
  // activeKeepaliveEditor: non-null only when the active tab uses a keep-alive
  // editor (controls visibility and hook binding).
  const [mountedKeepaliveEditor, setMountedKeepaliveEditor] =
    useState<Editor | null>(null);
  const [activeKeepaliveEditor, setActiveKeepaliveEditor] =
    useState<Editor | null>(null);
  // [MODERATE-9] On eviction, unmount EditorContent BEFORE editor.destroy().
  const handleEviction = useCallback(() => {
    setMountedKeepaliveEditor(null);
    setActiveKeepaliveEditor(null);
  }, []);
  const keepalive = useLargeDocKeepalive(handleEviction);
  const activeEditor = activeKeepaliveEditor ?? editor;
  // Stable callback for useTabSwitching to notify us of editor changes.
  // null = use shared editor; non-null = use this keep-alive editor.
  const handleActiveEditorChange = useCallback(
    (e: Editor | null) => {
      setActiveKeepaliveEditor(e);
      // Keep the EditorContent mounted as long as the editor exists
      if (e) setMountedKeepaliveEditor(e);
      // When switching away (e=null), do NOT unmount — the pool keeps it alive.
      // mountedKeepaliveEditor stays set so the DOM is preserved (hidden).
      // Keep plugin editor API pointed at the ACTIVE editor (keep-alive or shared)
      // synchronously — the tab-switch effect emits file:open in the same tick.
      pluginLoader.setEditor(e ?? editor);
    },
    [editor],
  );

  // [MINOR-11] Destroy pooled editors on App unmount / HMR cleanup.
  // [NEW-CRITICAL-A fix] Empty deps — true unmount-only. Pool identity is
  // now stable (ref-based) but we still read from a ref for belt-and-suspenders.
  const keepaliveRef = useRef(keepalive);
  keepaliveRef.current = keepalive;
  useEffect(() => {
    return () => keepaliveRef.current.destroyAll();
  }, []);

  return {
    activeEditor,
    activeKeepaliveEditor,
    keepalive,
    mountedKeepaliveEditor,
    onActiveEditorChange: handleActiveEditorChange,
  };
}
