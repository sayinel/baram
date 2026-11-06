// §perf-large-file C3.5: keep-alive editor pool state — owns the pooled
// editor(s) for large documents and the "which editor is active" derivation
// the rest of App reads (`activeEditor`).
import { useCallback, useEffect, useRef, useState } from "react";

import type { Editor } from "@tiptap/react";

import { clearSearchIfFindClosed } from "../extensions/plugins/find-replace";
import { pluginLoader } from "../plugins/plugin-loader";
import { useEditorStore } from "../stores/editor/editor";
import { useFileStore } from "../stores/file/file";
import { serializeLiveDoc } from "../utils/editor/serialize-live-doc";
import { logger } from "../utils/logger";
import {
  type EvictionCallback,
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
  const handleEviction = useCallback<EvictionCallback>(
    (tabId, evicted, complete) => {
      // The pool is about to destroy this editor, and it holds the only copy of unsaved text. An
      // entry the load never finished holds only part of it, a tab in source mode keeps its text
      // in the buffer, and a stale one is older than what `openFiles` already has.
      const { documentSurfaceAccess, sourceModeTabs, staleContentTabs, tabs } =
        useEditorStore.getState();
      const tab = tabs.find((t) => t.id === tabId);
      if (complete) {
        // A state cached for this tab is older than this editor, and coming back restores it first.
        documentSurfaceAccess?.editorStateCache.delete(tabId);
      }
      if (
        complete &&
        tab?.isDirty &&
        !sourceModeTabs.includes(tabId) &&
        !staleContentTabs.includes(tabId)
      ) {
        try {
          useFileStore
            .getState()
            .setFileContent(tab.filePath || tabId, serializeLiveDoc(evicted));
        } catch (err) {
          // The pool still has to make room for the tab being opened.
          logger.error("keepalive: could not keep an evicted tab's text", err);
        }
      }
      setMountedKeepaliveEditor(null);
      setActiveKeepaliveEditor(null);
    },
    [],
  );
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
      // §5.6 Find 가 닫혀 있으면 새 활성 편집기의 검색을 지운다(#792). 탭 전환이 활성 편집기를
      // 정하는 호출은 모두 이 콜백이다 — use-tab-switching 의 null 넷, resume-keepalive-tab ·
      // load-tab-content 의 편집기 하나씩(`grep -rn "onActiveEditorChange(" src`, 테스트 제외).
      // 이 콜백을 거치지 않는 변화는 위 `handleEviction` 의 null 뿐이다. 그것을 부르는 pool 호출은
      // 탭 전환 안의 acquire(load-tab-content — 곧이어 이 콜백) · release 둘(use-tab-switching —
      // 곧이어 이 콜백, gc-closed-tabs — 이 콜백이 이미 null 을 정한 load 경로 안)과 언마운트의
      // destroyAll 이다. 동기로 지우므로 탭 전환이 그 뒤 타이머로 넣는 Global Search 강조와
      // 순서가 정해진다 — 지우기가 먼저다.
      const next = e ?? editor;
      if (next) clearSearchIfFindClosed(next.view);
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
