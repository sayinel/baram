import type { Editor } from "@tiptap/react";

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useCaptureEditor } from "../use-capture-editor";

/**
 * 입력 규칙을 실제로 발동시키며 텍스트를 넣는다 — `task-input-rules.test.ts`와
 * 같은 패턴. `setContent`는 노드를 직접 만들어 입력 규칙 매칭 경로
 * (`@tiptap/core`의 `InputRule.ts` → `inputRulesPlugin`)를 절대 태우지 않는다.
 * `applyInputRules: true`는 `tr.setMeta('applyInputRules', ...)`만 남기고 실제
 * 매칭은 `apply()`가 `setTimeout`으로 다음 macrotask에서 수행하므로, 그 tick을
 * 흘려보낸 뒤에 반환한다.
 */
async function type(editor: Editor, text: string): Promise<void> {
  editor.commands.focus("end");
  const pos = editor.state.selection.from;
  editor.commands.insertContentAt(pos, text, { applyInputRules: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("§323 useCaptureEditor", () => {
  it("닫혀 있으면 편집기를 만들지 않는다", () => {
    const { result } = renderHook(() => useCaptureEditor(false));
    expect(result.current.editor).toBeNull();
  });

  it("열리면 편집기를 만들고 빈 상태로 시작한다", async () => {
    const { result } = renderHook(() => useCaptureEditor(true));
    await act(async () => {});
    expect(result.current.editor).not.toBeNull();
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.getMarkdown()).toBe("");
  });

  it("입력한 내용을 마크다운으로 돌려준다", async () => {
    const { result } = renderHook(() => useCaptureEditor(true));
    await act(async () => {});
    await act(async () => {
      result.current.editor!.commands.setContent("<h2>제목</h2><p>본문</p>");
    });
    const md = result.current.getMarkdown();
    expect(md).toContain("## 제목");
    expect(md).toContain("본문");
    expect(result.current.isEmpty).toBe(false);
  });

  it("reset은 문서를 비운다", async () => {
    const { result } = renderHook(() => useCaptureEditor(true));
    await act(async () => {});
    await act(async () => {
      result.current.editor!.commands.setContent("<p>x</p>");
    });
    await act(async () => result.current.reset());
    expect(result.current.isEmpty).toBe(true);
  });

  // 다이얼로그는 열고 닫기가 잦다. 파기하지 않으면 인스턴스가 쌓인다.
  it("언마운트하면 편집기를 파기한다", async () => {
    const { result, unmount } = renderHook(() => useCaptureEditor(true));
    await act(async () => {});
    const editor = result.current.editor!;
    unmount();
    expect(editor.isDestroyed).toBe(true);
  });

  it("캡처 프로파일이 적용된다 — vim이 실려 있지 않다", async () => {
    const { result } = renderHook(() => useCaptureEditor(true));
    await act(async () => {});
    const loaded = result.current.editor!.extensionManager.extensions.map(
      (e) => e.name,
    );
    expect(loaded).not.toContain("wysiwygVim");
  });

  // ‼️ Finding 1 회귀 핀. `Editor.isEmpty`(→ `isNodeEmpty`)는 기본값
  // `ignoreWhitespace: false`라 공백만 있는 텍스트 노드를 "비어 있지 않다"고
  // 본다. `setContent(html)`은 HTML 파싱 중 공백 전용 텍스트 노드를 접어
  // 없애 버리므로 이 결함에 절대 닿지 못한다 — 그래서 실제 트랜잭션
  // (`tr.insertText`)으로 공백을 넣는다.
  it("공백만 있는 본문은 비어 있다고 본다", async () => {
    const { result } = renderHook(() => useCaptureEditor(true));
    await act(async () => {});
    const editor = result.current.editor!;
    await act(async () => {
      const { view } = editor;
      view.dispatch(view.state.tr.insertText("   ", 1));
    });
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.getMarkdown()).toBe("");
  });

  // ‼️ Finding 2 회귀 핀. Task 2의 유일한 헤딩 테스트는 `setContent("<h2>...")`로
  // 노드를 직접 만들어, "## "를 타이핑하면 실제로 헤딩이 되는지(입력 규칙 매칭
  // 경로)는 아무도 확인한 적이 없었다 — Finding 1이 모든 테스트를 통과한 채로
  // 숨어 있었던 이유이기도 하다(`setContent`가 공백 전용 텍스트 노드를 접기
  // 때문). `type()` 헬퍼로 실제 입력 규칙 파이프라인을 태운다.
  it("'## '를 실제로 타이핑하면 heading 입력 규칙이 발동한다", async () => {
    const { result } = renderHook(() => useCaptureEditor(true));
    await act(async () => {});
    const editor = result.current.editor!;

    await act(async () => {
      await type(editor, "## ");
    });
    expect(editor.state.doc.firstChild?.type.name).toBe("heading");

    await act(async () => {
      await type(editor, "제목");
    });

    const md = result.current.getMarkdown();
    expect(md).toContain("## 제목");
  });
});
