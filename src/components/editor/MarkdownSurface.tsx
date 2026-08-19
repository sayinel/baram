// §286 마크다운 편집 표면 — **항상 마운트**된다.
//
// 예전에는 App.tsx의 삼항 사슬 마지막 갈래였다. 그래서 PDF·코드·그래프 탭으로 가면 React가
// 이 서브트리를 언마운트했고, Tiptap의 `EditorContent.componentWillUnmount`가
// `nodeViews: {}`로 **모든 NodeView를 파기**한 뒤 ProseMirror DOM을 분리된 div로 옮겼다
// (node_modules/@tiptap/react/dist/index.js). 돌아오면 `createNodeViews()`가 다시 만들고
// 포털은 다음 틱에 마운트되므로, 스크롤 복원이 **높이가 확정되기 전에** 실행되어 잘렸다 —
// 사용자에게는 "탭을 다녀오면 문서 처음으로 간다"로 보였다.
//
// 사슬 밖으로 꺼내 숨기기만 하면 그 사슬 전체가 성립하지 않는다: 언마운트가 없으니 파기할
// NodeView도, 복원할 것도 없다. 편집기 인스턴스는 원래 하나뿐이라 메모리 대가도 없다.
import type { MutableRefObject } from "react";
import { useRef } from "react";

import type { UseInlineAIReturn } from "../../hooks/use-inline-ai";
import type { Editor } from "@tiptap/react";

import { EditorContent } from "@tiptap/react";

import { useTabScrollMemory } from "../../hooks/use-tab-scroll-memory";
import { InlineAIPrompt } from "../ai/InlineAIPrompt";
import { BlockHandle } from "../toolbar/BlockHandle";
import { ContextMenu } from "../toolbar/ContextMenu";
import { FloatingToolbar } from "../toolbar/FloatingToolbar";
import { TableInsertButtons } from "../toolbar/TableInsertButtons";
import { TableSelectionHandles } from "../toolbar/TableSelectionHandles";
import { TableToolbar } from "../toolbar/TableToolbar";
import { FindReplaceBar } from "./FindReplaceBar";

interface MarkdownSurfaceProps {
  /** 활성 탭이 WYSIWYG 마크다운인가. 거짓이면 숨긴다(마운트는 유지). */
  active: boolean;
  /** 오버레이가 붙을 편집기 — keep-alive 탭이면 그쪽이다. */
  activeEditor: Editor | null;
  /** §perf-large-file C3.5 keep-alive 편집기가 지금 보여야 하는가. */
  activeKeepaliveEditor: Editor | null;
  /**
   * 공유 편집기. 항상 EditorContent로 렌더된다.
   *
   * null 허용은 App의 `useEditor()`가 첫 렌더에서 null을 돌려주기 때문이다 —
   * `EditorContent`는 그 값을 그대로 받는다(예전 인라인 JSX와 동일).
   */
  editor: Editor | null;
  findReplaceMode: "find" | "replace";
  findReplaceOpen: boolean;
  inlineAI: UseInlineAIReturn;
  /** §perf-large-file B2 Worker 파싱 중 스켈레톤. */
  isParsing: boolean;
  /** 풀에 들어 있는 대용량 문서 편집기. 없으면 null. */
  mountedKeepaliveEditor: Editor | null;
  onFindReplaceClose: () => void;
  onFindReplaceModeChange: (mode: "find" | "replace") => void;
  /**
   * §291 탭별 스크롤 오프셋 맵. 이 표면이 **기록**하고, 탭이 바뀌는 전환의 복원은
   * use-tab-switching이 같은 맵을 읽어서 한다(그쪽은 콘텐츠 설치 뒤에 돌아야 하므로).
   */
  scrollOffsets: MutableRefObject<Map<string, number>>;
  /** 지금 이 표면이 보여주고 있는 탭. 오프셋 맵의 키다. */
  tabId: null | string;
}

export function MarkdownSurface({
  active,
  activeEditor,
  activeKeepaliveEditor,
  editor,
  findReplaceMode,
  findReplaceOpen,
  inlineAI,
  isParsing,
  mountedKeepaliveEditor,
  onFindReplaceClose,
  onFindReplaceModeChange,
  scrollOffsets,
  tabId,
}: MarkdownSurfaceProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // §291 스크롤 위치는 **scroll 이벤트로** 기록한다. 나가는 순간에 읽으려 하면 이미
  // display:none이 적용돼 있어 0이 잡힌다 — 이 앱에서 실제로 그렇게 깨졌다.
  useTabScrollMemory(
    tabId ?? "",
    active && !!tabId,
    () => {
      const el = wrapperRef.current;
      if (!el) return null;
      return {
        element: el,
        getScrollTop: () => el.scrollTop,
        setScrollTop: (n: number) => {
          el.scrollTop = n;
        },
      };
    },
    scrollOffsets,
  );

  return (
    <>
      {active && findReplaceOpen && activeEditor && (
        <FindReplaceBar
          editor={activeEditor}
          mode={findReplaceMode}
          onClose={onFindReplaceClose}
          onSetMode={onFindReplaceModeChange}
        />
      )}
      <div
        className="editor-area-scroll"
        ref={wrapperRef}
        // ‼️ 활성일 때만 단다. activeEditorScrollContainer(§288 규칙 4)가 이 표시로 숨은
        // 컨테이너를 걸러내므로, 항상 달려 있으면 그 헬퍼가 무력해진다.
        {...(active ? { "data-editor-active": "" } : {})}
        data-editor-scroll
        style={{ display: active ? undefined : "none" }}
      >
        {/* §perf-large-file B2: Loading skeleton while Worker parses */}
        {isParsing && (
          <div className="editor-loading-skeleton">
            <div className="skeleton-line w-3/4" />
            <div className="skeleton-line w-full" />
            <div className="skeleton-line w-5/6" />
            <div className="skeleton-line w-2/3" />
            <div className="skeleton-line w-full" />
            <div className="skeleton-line w-1/2" />
          </div>
        )}
        {/* §perf-large-file C3.5: keep-alive editor — stays mounted while
            in pool (DOM kept alive), hidden when another tab is active. */}
        {mountedKeepaliveEditor && (
          <div
            data-keepalive-editor
            style={{ display: activeKeepaliveEditor ? "" : "none" }}
          >
            <EditorContent editor={mountedKeepaliveEditor} />
          </div>
        )}
        {/* Shared editor — hidden when a keep-alive editor is active */}
        <div style={{ display: activeKeepaliveEditor ? "none" : "" }}>
          <EditorContent editor={editor} />
        </div>
        {/* 오버레이는 활성일 때만. 숨은 표면의 rect는 전부 0이라(§288) 위치 계산이
            무의미하고, 툴바가 보이지 않는 문서를 따라다닐 이유도 없다. */}
        {active && activeEditor && (
          <>
            <FloatingToolbar editor={activeEditor} />
            <TableToolbar editor={activeEditor} />
            <BlockHandle editor={activeEditor} />
            <TableInsertButtons editor={activeEditor} />
            <TableSelectionHandles editor={activeEditor} />
            <ContextMenu editor={activeEditor} />
            {inlineAI.isActive && inlineAI.phase !== "idle" && (
              <InlineAIPrompt
                editor={activeEditor}
                hasSelection={inlineAI.hasSelection}
                hunks={inlineAI.hunks}
                onAccept={inlineAI.accept}
                onAcceptHunk={inlineAI.acceptHunk}
                onClose={inlineAI.cancel}
                onRegenerate={inlineAI.regenerate}
                onReject={inlineAI.reject}
                onRejectHunk={inlineAI.rejectHunk}
                onSubmit={inlineAI.submitPrompt}
                phase={inlineAI.phase as "completed" | "input" | "streaming"}
                selectionFrom={inlineAI.selectionFrom}
                selectionTo={inlineAI.selectionTo}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}
