/*
 * §313 닫혀 있던 문서의 태스크를 누르면 — **한 번에** 그 줄로 간다.
 *
 * 보고된 형태: 첫 클릭은 파일을 열기만 하고, 두 번째 클릭에서야 그 자리로 갔다. 첫
 * 클릭에서는 파일이 열리는 동안(비동기 읽기) 요청이 걸려 있고, 문서가 실제로 들어온 뒤
 * `afterDocLoad`가 그것을 소비한다. 두 번째 클릭은 파일이 이미 활성이라 `takeSameTabScroll`
 * 경로를 탄다 — 즉 두 경로가 서로 다른 시점의 **문서**를 본다는 것이 이 결함의 자리다.
 *
 * 여기서는 차가운 경로(탭이 없다 → 열린다 → 문서가 도착한다)를 진짜 훅 두 개로 돌리고,
 * 배선이 아니라 커서가 앉은 블록의 텍스트만 본다.
 */
import { useRef } from "react";

import type { EditorTab } from "../../stores/editor/editor";
import type { Editor } from "@tiptap/core";

import { act, renderHook, waitFor } from "@testing-library/react";
import { EditorState } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeTestEditor } from "../../__tests__/helpers/make-test-editor";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { useEditorStore } from "../../stores/editor/editor";
import { useLinkStore } from "../../stores/editor/link";
import { useFileStore } from "../../stores/file/file";
import { useUIStore } from "../../stores/ui/ui";
import { requestScroll } from "../../utils/editor/pending-scroll";
import { useEditorEffects } from "../use-editor-effects";
import { createKeepalivePool } from "../use-large-doc-keepalive";
import { useTabSwitching } from "../use-tab-switching";

const NOTE = "/v/note.md";
const OTHER = "/v/other.md";
const MD = [
  "# Title",
  "",
  "- [ ] first task",
  "- [ ] second task",
  "- [ ] third task",
  "",
  "After the list.",
  "",
].join("\n");
/** `- [ ] third task`는 0-based 4행 — 아젠다는 `line + 1`을 건다. */
const THIRD_TASK_LINE = 5;

const tab = (id: string, filePath: string): EditorTab => ({
  contextId: "c",
  filePath,
  id,
  isDirty: false,
  isPinned: false,
  title: id,
});

let editor: Editor;

function caretBlockText(): string {
  return editor.state.selection.$from.parent.textContent;
}

function mountApp() {
  return renderHook(() => {
    const appendHandleRef = useRef(null);
    const editorStateCache = useRef(new Map<string, EditorState>());
    const isNavBackForwardRef = useRef(false);
    useTabSwitching({
      appendHandleRef,
      createKeepaliveEditor: () => editor,
      editor,
      editorStateCache,
      getSourceBuffer: () => "",
      isNavBackForwardRef,
      keepalive: createKeepalivePool(),
      onActiveEditorChange: vi.fn(),
      scrollOffsets: { current: new Map<string, number>() },
      setFindReplaceMode: vi.fn(),
      setFindReplaceOpen: vi.fn(),
      setIsParsing: vi.fn(),
      setSourceBuffer: vi.fn(),
      sourceModeTabs: new Set<string>(),
    });
    useEditorEffects({
      editor,
      editorStateCache,
      inlineAI: { applyContent: vi.fn() },
      setFindReplaceMode: vi.fn(),
      setFindReplaceOpen: vi.fn(),
    });
    return null;
  });
}

/** `openFileByPath`가 닫힌 파일에 하는 일 — 내용을 먼저 캐시하고 탭을 연다. */
function openClosedFile(path: string, content: string) {
  useFileStore.getState().setFileContent(path, content);
  useEditorStore.getState().openTab({
    contextId: "c",
    filePath: path,
    id: "opened",
    isDirty: false,
    isPinned: false,
    title: "note",
  });
}

beforeEach(() => {
  editor = makeTestEditor("<p>placeholder</p>");
  useLinkStore.getState().clearPendingScroll();
  useUIStore.getState().setPendingSearchHighlight(null);
  useFileStore.setState({
    openFiles: new Map([[OTHER, "# other\n"]]),
    rootPath: "/v",
  });
  useEditorStore.setState({
    activeTabId: "t-other",
    mruOrder: ["t-other"],
    sourceModeTabs: [],
    tabs: [tab("t-other", OTHER)],
  });
});

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 40));
  editor.destroy();
});

/** 그 탭을 떠날 때 캐시된 EditorState — 되돌아오면 이 상태가 복원된다. */
function cacheStateFor(md: string): EditorState {
  return EditorState.create({
    doc: markdownToProsemirror(md, editor.schema),
    plugins: editor.state.plugins,
  });
}

describe("차가운 경로 — 닫혀 있던 파일", () => {
  it("첫 클릭에 문서가 열리고 커서가 그 태스크에 앉는다", async () => {
    const { rerender } = mountApp();

    await act(async () => {
      requestScroll(NOTE, { kind: "line", value: THIRD_TASK_LINE });
      openClosedFile(NOTE, MD);
    });
    rerender();

    await waitFor(() => expect(caretBlockText()).toBe("third task"));
    // 요청은 소비됐다 — 남으면 다음 전환이 엉뚱한 문서에 쓴다.
    expect(useLinkStore.getState().pendingScrollPath).toBeNull();
  });
});

describe("캐시된 탭으로 돌아가는 경로", () => {
  it("복원된 문서 기준으로 그 태스크에 앉는다", async () => {
    // 이 탭은 이전에 열려 있었다 — EditorState가 캐시에 있다.
    useFileStore.getState().setFileContent(NOTE, MD);
    useEditorStore.setState({
      activeTabId: "t-other",
      mruOrder: ["t-other", "t-note"],
      sourceModeTabs: [],
      tabs: [tab("t-other", OTHER), tab("t-note", NOTE)],
    });

    const cache = new Map<string, EditorState>();
    const { rerender } = renderHook(() => {
      const appendHandleRef = useRef(null);
      const editorStateCache = useRef(cache);
      const isNavBackForwardRef = useRef(false);
      useTabSwitching({
        appendHandleRef,
        createKeepaliveEditor: () => editor,
        editor,
        editorStateCache,
        getSourceBuffer: () => "",
        isNavBackForwardRef,
        keepalive: createKeepalivePool(),
        onActiveEditorChange: vi.fn(),
        scrollOffsets: { current: new Map<string, number>() },
        setFindReplaceMode: vi.fn(),
        setFindReplaceOpen: vi.fn(),
        setIsParsing: vi.fn(),
        setSourceBuffer: vi.fn(),
        sourceModeTabs: new Set<string>(),
      });
      useEditorEffects({
        editor,
        editorStateCache,
        inlineAI: { applyContent: vi.fn() },
        setFindReplaceMode: vi.fn(),
        setFindReplaceOpen: vi.fn(),
      });
      return null;
    });
    cache.set("t-note", cacheStateFor(MD));

    await act(async () => {
      requestScroll(NOTE, { kind: "line", value: THIRD_TASK_LINE });
      useEditorStore.getState().setActiveTab("t-note");
    });
    rerender();

    await waitFor(() => expect(caretBlockText()).toBe("third task"));
  });
});
