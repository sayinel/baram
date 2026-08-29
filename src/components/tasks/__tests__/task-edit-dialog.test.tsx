import { fireEvent, render, screen } from "@testing-library/react";
// M2-b4 태스크 편집 모달.
//
// 진짜 에디터 위에서 돌린다. 이 모달의 위험은 전부 문서 쪽에 있다 — 열었다 그냥 닫아도
// 줄이 바뀌거나, 거절해야 할 자리에서 문서를 태스크로 바꿔 놓거나, 위키링크를 잃는 것.
// 폼만 mock 위에서 시험하면 그 셋 중 아무것도 잡히지 않는다.
import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EditorProvider } from "../../../contexts/editor-context";
import { createBaramExtensions } from "../../../extensions";
import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../../pipeline/pm-to-md";
import { useUIStore } from "../../../stores/ui/ui";
import { TaskEditDialog } from "../TaskEditDialog";

let editor: Editor | null = null;

beforeEach(() => {
  useUIStore.setState({ taskEditOpen: false });
});

afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** 마크다운 한 덩이를 띄우고 첫 텍스트에 커서를 둔 뒤 모달을 연다. */
function markdown(ed: Editor): string {
  return prosemirrorToMarkdown(ed.state.doc).trim();
}

function open(markdown: string): Editor {
  const host = document.createElement("div");
  document.body.appendChild(host);
  editor = new Editor({ element: host, extensions: createBaramExtensions() });
  const doc = markdownToProsemirror(markdown, editor.state.schema);
  editor.commands.setContent(doc.toJSON() as never);

  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText) at = pos + 1;
    return at === -1;
  });
  editor.commands.setTextSelection(at);

  useUIStore.setState({ taskEditOpen: true });
  render(
    <EditorProvider value={editor}>
      <TaskEditDialog />
    </EditorProvider>,
  );
  return editor;
}

describe("TaskEditDialog", () => {
  it("기존 태스크의 값으로 폼이 채워진다", () => {
    open("- [ ] 초안 쓰기 #deep-work 📅2026-08-30 ⏫");
    expect(screen.getByDisplayValue("초안 쓰기")).toBeTruthy();
    expect(screen.getByDisplayValue("2026-08-30")).toBeTruthy();
    expect(screen.getByDisplayValue("deep-work")).toBeTruthy();
  });

  it("결과 줄을 미리 보여 준다 — 이모지 문법을 여기서 배운다", () => {
    open("- [ ] 초안 쓰기 📅2026-08-30");
    expect(screen.getByText("- [ ] 초안 쓰기 📅2026-08-30")).toBeTruthy();
  });

  it("아무것도 고치지 않고 저장하면 문서가 그대로다", () => {
    // 열어 보기만 해도 문서가 바뀌면 미리보기로도 가려지지 않는다 — 사용자는 바뀐 줄을
    // 자기가 바꾼 것으로 읽는다.
    const source = "- [ ] [[202607051530]] 절 쓰기 #deep-work 📅2026-08-30 ⏫";
    const ed = open(source);
    fireEvent.click(screen.getByText("Save"));
    expect(markdown(ed)).toBe(source);
  });

  it("기한을 고치면 그 필드만 바뀐다", () => {
    const ed = open("- [ ] 초안 📅2026-08-30 ⏫");
    fireEvent.change(screen.getByDisplayValue("2026-08-30"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.click(screen.getByText("Save"));
    expect(markdown(ed)).toBe("- [ ] 초안 📅2026-09-01 ⏫");
  });

  it("`t` 같은 약식 입력도 받는다 — 정리와 같은 어휘", () => {
    const ed = open("- [ ] 초안");
    // 네 날짜 칸은 placeholder가 같다 — 구분하는 것은 라벨뿐이다.
    const due = screen.getByLabelText("Due 📅");
    fireEvent.change(due, { target: { value: "2026-12-25" } });
    fireEvent.click(screen.getByText("Save"));
    expect(markdown(ed)).toContain("2026-12-25");
  });

  it("문단이면 저장할 때 태스크가 된다", () => {
    const ed = open("초안 쓰기");
    fireEvent.click(screen.getByText("Save"));
    expect(markdown(ed)).toBe("- [ ] 초안 쓰기");
  });

  it("거절하는 자리에서는 스스로 닫고 문서를 건드리지 않는다", () => {
    // 코드블록 안의 `- [ ] `는 코드지 태스크가 아니다.
    const ed = open("```\n- [ ] x\n```");
    expect(useUIStore.getState().taskEditOpen).toBe(false);
    expect(markdown(ed)).toBe("```\n- [ ] x\n```");
  });

  it("취소하면 문서를 건드리지 않는다", () => {
    const ed = open("- [ ] 초안 📅2026-08-30");
    fireEvent.change(screen.getByDisplayValue("초안"), {
      target: { value: "완전히 다른 것" },
    });
    fireEvent.click(screen.getByText("Cancel"));
    expect(markdown(ed)).toBe("- [ ] 초안 📅2026-08-30");
  });
});
