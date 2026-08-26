// §313 이미 열려 있는 파일의 태스크를 누르면 **그 줄로** 커서가 간다.
//
// 결함의 형태: `openFileByPath`는 이미 열린 파일에 대해 `setActiveTab(같은 id)`로
// 단락되고(`open-file.ts:13-17`), `useTabSwitching`의 effect는 `[activeTabId]`에만
// 걸려 있어 다시 돌지 않는다. 그래서 대기 중인 스크롤을 소비하는 세 소비자 중 어느
// 것도 실행되지 않았다 — 커서는 1행에 남고, 값은 소비되지 않은 채 남아 **다음** 탭
// 전환이 엉뚱한 파일을 그 줄 번호로 스크롤했다.
//
// 진짜 Tiptap 에디터와 진짜 `useEditorEffects`로 검증한다. 배선이 아니라 결과를
// 본다: 커서가 어느 블록에 있는가.
import { useRef } from "react";

import type { EditorTab } from "../../stores/editor/editor";
import type { Editor } from "@tiptap/core";

import { renderHook, waitFor } from "@testing-library/react";
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

const NOTE = "/v/note.md";
const MD = ["# Title", "", "alpha", "", "- [ ] task one", "", "beta", ""].join(
  "\n",
);
/** `- [ ] task one`은 0-based 4행 — 아젠다는 `line + 1`을 요청한다. */
const TASK_LINE_1BASED = 5;

const tab = (id: string, filePath: string): EditorTab => ({
  contextId: "c",
  filePath,
  id,
  isDirty: false,
  isPinned: false,
  title: id,
});

let editor: Editor;

/** 커서가 앉아 있는 블록의 텍스트 — 이 테스트가 보는 유일한 결과다. */
function caretBlockText(): string {
  return editor.state.selection.$from.parent.textContent;
}

function mountEffects() {
  return renderHook(() => {
    const editorStateCache = useRef(new Map<string, EditorState>());
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

beforeEach(() => {
  editor = makeTestEditor("<p></p>");
  editor.view.updateState(
    EditorState.create({
      doc: markdownToProsemirror(MD, editor.schema),
      plugins: editor.state.plugins,
    }),
  );
  useLinkStore.getState().clearPendingScroll();
  useFileStore.setState({ openFiles: new Map([[NOTE, MD]]) });
  useUIStore.setState({
    pendingApplyContent: null,
    pendingSearchHighlight: null,
  });
  useEditorStore.setState({
    activeTabId: "t1",
    mruOrder: ["t1"],
    tabs: [tab("t1", NOTE)],
  });
});

afterEach(() => {
  editor.destroy();
});

describe("이미 활성인 탭의 태스크를 누를 때", () => {
  it("커서가 그 태스크 줄로 간다", async () => {
    mountEffects();
    expect(caretBlockText()).toBe("Title");

    requestScroll(NOTE, { kind: "line", value: TASK_LINE_1BASED });

    await waitFor(() => expect(caretBlockText()).toContain("task one"));
  });

  it("요청을 소비하고 남기지 않는다", async () => {
    mountEffects();

    requestScroll(NOTE, { kind: "line", value: TASK_LINE_1BASED });

    await waitFor(() =>
      expect(useLinkStore.getState().pendingScrollLine).toBeNull(),
    );
    expect(useLinkStore.getState().pendingScrollPath).toBeNull();
  });

  it("다른 파일을 향한 요청에는 커서를 옮기지 않고, 요청도 남겨 둔다", async () => {
    // 아직 열리지 않은(또는 배경 탭인) 파일을 향한 요청은 탭 전환이 배달한다.
    // 여기서 소비하면 화면에 있는 다른 문서를 그 줄 번호로 스크롤한다.
    mountEffects();

    requestScroll("/v/other.md", { kind: "line", value: TASK_LINE_1BASED });

    await waitFor(() =>
      expect(useLinkStore.getState().pendingScrollPath).toBe("/v/other.md"),
    );
    expect(caretBlockText()).toBe("Title");
    expect(useLinkStore.getState().pendingScrollLine).toBe(TASK_LINE_1BASED);
  });
});
