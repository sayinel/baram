// §44 Editor effects hook — selection tracking, content reload, goto-position, window title
import { useEffect } from "react";

import type { Editor } from "@tiptap/core";

import { EditorState, TextSelection } from "@tiptap/pm/state";
import { useShallow } from "zustand/shallow";

import { dispatchSetSearchTerm } from "../extensions/plugins/find-replace";
import { replaceEditorStateWithVim } from "../extensions/plugins/vim/replace-editor-state";
import { withVimExternalEdit } from "../extensions/plugins/vim/vim-keys";
import { markdownToProsemirror } from "../pipeline/md-to-pm";
import { isFileTab } from "../stores/editor/editor";
import { useEditorStore } from "../stores/editor/editor";
import { useLinkStore } from "../stores/editor/link";
import { useFileStore } from "../stores/file/file";
import { useUIStore } from "../stores/ui/ui";
import { patchEditorContent } from "../utils/editor/patch-editor-content";
import {
  scrollToTarget,
  takeSameTabScroll,
} from "../utils/editor/pending-scroll";

interface UseEditorEffectsParams {
  editor: Editor | null;
  editorStateCache: React.MutableRefObject<Map<string, EditorState>>;
  inlineAI: { applyContent: (content: string) => void };
  setFindReplaceMode: (mode: "find" | "replace") => void;
  setFindReplaceOpen: (open: boolean) => void;
}

export function useEditorEffects({
  editor,
  editorStateCache,
  inlineAI,
  setFindReplaceMode,
  setFindReplaceOpen,
}: UseEditorEffectsParams) {
  const { activeTabId, tabs } = useEditorStore(
    useShallow((s) => ({ activeTabId: s.activeTabId, tabs: s.tabs })),
  );

  // §44 Track editor selection text for @selection reference
  useEffect(() => {
    if (!editor) return;
    const handleSelectionUpdate = () => {
      const { from, to } = editor.state.selection;
      const text =
        from === to ? "" : editor.state.doc.textBetween(from, to, " ");
      useEditorStore.getState().setCurrentSelection(text);
    };
    editor.on("selectionUpdate", handleSelectionUpdate);
    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate);
    };
  }, [editor]);

  // §44 Apply AI chat content to editor — with diff preview when selection exists
  useEffect(() => {
    const unsub = useUIStore.subscribe((state) => {
      const content = state.pendingApplyContent;
      if (!content || !editor) return;
      const { from, to } = editor.state.selection;
      if (from !== to) {
        // Selection exists — show diff preview via AI Diff plugin
        inlineAI.applyContent(content);
      } else {
        // No selection — parse markdown and insert as ProseMirror nodes
        const doc = markdownToProsemirror(content, editor.schema);
        const slice = doc.content;
        editor.view.dispatch(
          withVimExternalEdit(
            editor.state.tr.insert(from, slice).scrollIntoView(),
          ),
        );
        editor.view.focus();
      }
      useUIStore.getState().setPendingApplyContent(null);
    });
    return unsub;
  }, [editor, inlineAI]);

  // §5.11 Activate Find highlights from Global Search result click (same-tab case)
  //
  // §313 ‼️ 하이라이트만 켠다. 예전에는 이 자리가 `pendingScrollLine`도 함께 집어
  // 갔는데, 그 값은 **주소를 보지 않고** 읽혔다. 그래서 배경 탭의 검색 결과를 누르면
  // 커서가 나가는 문서의 그 줄로 갔고(스크롤 요청은 들어오는 문서 앞으로 온 것이다),
  // 줄 번호는 삼켜진 채 주소만 남아 다음 요청 — 위키링크 블록 점프 같은 — 까지 조용히
  // 버려졌다. 스크롤은 주소를 아는 소비자 셋에게만 맡긴다: 아래 §313 effect(같은 탭),
  // 그리고 `useTabSwitching`의 keep-alive·`afterDocLoad` 분기(탭 전환). 셋 다
  // `takeSameTabScroll`/`takePendingScroll`을 지나므로 주소가 다른 요청은 적용되지도,
  // 소비되지도 않는다.
  const pendingSearchHighlight = useUIStore((s) => s.pendingSearchHighlight);
  useEffect(() => {
    if (!pendingSearchHighlight || !editor?.view) return;
    // If already consumed by activeTabId effect (tab-switch case), skip
    if (!useUIStore.getState().pendingSearchHighlight) return;
    useUIStore.getState().setPendingSearchHighlight(null);
    // Delay to ensure editor state is settled after tab switch
    requestAnimationFrame(() => {
      if (!editor?.view) return;
      dispatchSetSearchTerm(editor.view, pendingSearchHighlight);
      setFindReplaceOpen(true);
      setFindReplaceMode("find");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setFindReplaceOpen/setFindReplaceMode are stable store actions
  }, [pendingSearchHighlight, editor]);

  // §313 이미 활성인 탭 앞으로 온 스크롤 요청을 배달한다.
  //
  // `openFileByPath`는 이미 열린 파일에 대해 `setActiveTab(같은 id)`로 단락되고
  // (`open-file.ts:13-17`), `useTabSwitching`의 effect는 `[activeTabId]`에만 걸려 있어
  // 다시 돌지 않는다. 그래서 열려 있는 노트의 태스크를 아젠다에서 누르거나 그 노트를
  // 가리키는 백링크를 누르면 소비자가 하나도 실행되지 않았다 — 커서는 1행에 남고, 값은
  // 남아서 **다음** 탭 전환이 엉뚱한 파일에 적용했다.
  //
  // 위 §5.11 하이라이트 effect가 이 일을 겸하고 있었지만 그것은 검색 하이라이트 신호에
  // 걸려 있다("스크롤"을 뜻하려고 그 값을 세우는 것이 이 결함을 헷갈리게 만든 원인이다).
  // 스크롤 요청은 자기 신호(`pendingScrollRequest`)로 배달한다.
  const pendingScrollRequest = useLinkStore((s) => s.pendingScrollRequest);
  useEffect(() => {
    if (!pendingScrollRequest || !editor?.view) return;
    const target = takeSameTabScroll();
    if (!target) return;
    const { activeTabId: tabId, tabs: currentTabs } = useEditorStore.getState();
    const tab = currentTabs.find((t) => t.id === tabId);
    const content = tab?.filePath
      ? useFileStore.getState().openFiles.get(tab.filePath)
      : undefined;
    scrollToTarget(editor.view, content ?? null, target);
  }, [pendingScrollRequest, editor]);

  // §5.11 Reload editor content after Global Search Replace / Quick Capture
  const contentReloadVersion = useUIStore((s) => s.contentReloadVersion);
  useEffect(() => {
    if (!contentReloadVersion || !editor?.view) return;
    const { activeTabId: tabId, tabs: currentTabs } = useEditorStore.getState();
    const incomingTab = currentTabs.find((t) => t.id === tabId);
    if (!incomingTab?.filePath) return;
    const content = useFileStore.getState().openFiles.get(incomingTab.filePath);
    if (content === undefined) return;
    // Invalidate stale EditorState caches for replaced files
    editorStateCache.current.clear();
    const cursorEnd = useUIStore.getState().contentReloadCursorEnd;
    // Re-parse and update editor from file-store
    const newDoc = markdownToProsemirror(content, editor.schema);
    const prevPos = editor.state.selection.anchor;
    const selPos = cursorEnd
      ? newDoc.content.size
      : Math.min(prevPos, newDoc.content.size);
    const newState = EditorState.create({
      doc: newDoc,
      selection: TextSelection.near(newDoc.resolve(selPos), -1),
      plugins: editor.state.plugins,
    });
    replaceEditorStateWithVim(editor.view, newState, "fresh-document");
    // Focus and scroll to new cursor position after dialog closes.
    // Use DOM scrollIntoView (not ProseMirror tr.scrollIntoView) because
    // updateState bypasses the normal transaction pipeline.
    setTimeout(() => {
      try {
        editor.view.focus();
        const { from } = editor.view.state.selection;
        const domInfo = editor.view.domAtPos(from);
        const el =
          domInfo.node instanceof HTMLElement
            ? domInfo.node
            : domInfo.node.parentElement;
        el?.scrollIntoView({ block: "center" });
      } catch {
        /* ignore */
      }
    }, 50);
    // Intentionally only re-run on contentReloadVersion bump; editor and other
    // values are read from store state to avoid re-running on every edit.
  }, [contentReloadVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // §72 External content refresh (PropertiesPanel → editor sync)
  const contentRefreshKey = useEditorStore((s) => s.contentRefreshKey);
  useEffect(() => {
    if (!contentRefreshKey || !editor?.view) return;
    const {
      activeTabId: tabId,
      contentRefreshMode,
      contentRefreshPath,
      tabs: currentTabs,
    } = useEditorStore.getState();
    const tab = currentTabs.find((t) => t.id === tabId);
    if (!tab?.filePath) return;
    // §313 다른 파일에 온 변경이면 이 탭의 일이 아니다. 이 관문이 없으면 배경 파일의
    // 변경 하나가 활성 탭을 그 탭의 (더 낡은) openFiles 스냅샷으로 되돌린다 — dirty
    // 탭에서는 방금 친 글자가 사라진다는 뜻이다.
    if (contentRefreshPath !== null && contentRefreshPath !== tab.filePath) {
      return;
    }
    const content = useFileStore.getState().openFiles.get(tab.filePath);
    if (content === undefined) return;
    // §313 앱 자신이 만든 변경은 트랜잭션 하나로 맞춘다 — 실행 취소 스택도 커서도
    // 노드 뷰도 그대로 둔다. 아래 전체 재구축은 **남의 편집**에만 쓴다: 그쪽은 되돌리기가
    // 그 편집 너머로 걸어가지 못하게 히스토리를 끊는 것이 오히려 안전장치다.
    if (contentRefreshMode === "patch") {
      patchEditorContent(editor.view, content);
      return;
    }
    const newDoc = markdownToProsemirror(content, editor.schema);
    const prevPos = editor.state.selection.anchor;
    const selPos = Math.min(prevPos, newDoc.content.size);
    const newState = EditorState.create({
      doc: newDoc,
      selection: TextSelection.near(newDoc.resolve(selPos), -1),
      plugins: editor.state.plugins,
    });
    replaceEditorStateWithVim(editor.view, newState, "fresh-document");
    // Intentionally only re-run on contentRefreshKey bump; editor and other
    // values are read from store state to avoid re-running on every edit.
  }, [contentRefreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // §72c Navigate to ProseMirror position from lint results / external panels
  useEffect(() => {
    const handler = (e: CustomEvent<{ from: number }>) => {
      if (!editor) return;
      editor.commands.setTextSelection(e.detail.from);
      editor.commands.scrollIntoView();
      editor.commands.focus();
    };
    window.addEventListener("baram:goto-position", handler as EventListener);
    return () =>
      window.removeEventListener(
        "baram:goto-position",
        handler as EventListener,
      );
  }, [editor]);

  // --- Window title update ---
  useEffect(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    document.title = tab
      ? `${tab.isDirty && isFileTab(tab) ? "\u25CF " : ""}${tab.title} \u2014 Baram`
      : "Baram";
  }, [activeTabId, tabs]);
}
