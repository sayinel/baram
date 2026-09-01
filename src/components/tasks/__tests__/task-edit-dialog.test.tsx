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
import { useEditorStore } from "../../../stores/editor/editor";
import { useUIStore } from "../../../stores/ui/ui";
import { TaskEditDialog } from "../TaskEditDialog";

let editor: Editor | null = null;

beforeEach(() => {
  useUIStore.setState({ taskEditOpen: false });
  useEditorStore.setState({ activeTabId: null, sourceModeTabs: [] });
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

  // 이슈 498 (감사 BLOCKER): 소스 모드는 PM 문서를 별도 버퍼로 스냅샷한다.
  // 이 모달의 저장은 PM에만 닿으므로, 소스 모드가 활성인 동안의 저장은 (a) 복귀 시
  // 옛 버퍼가 PM을 덮어쓰며 소실되고 (b) 소스 모드 중 Cmd+S는 옛 버퍼를 디스크에
  // 쓴다. 그래서 소스 모드에서는 아예 열리지 않아야 하고(거절하는 자리와 같은 계약),
  // 열린 채 소스 모드로 전환됐다면 저장이 거부돼야 한다.
  it("소스 모드에서 열면 거절하는 자리처럼 스스로 닫는다", () => {
    useEditorStore.setState({ activeTabId: "t1", sourceModeTabs: ["t1"] });
    const ed = open("- [ ] 초안");
    expect(useUIStore.getState().taskEditOpen).toBe(false);
    expect(markdown(ed)).toBe("- [ ] 초안");
  });

  it("열린 채 소스 모드로 전환되면 저장을 거부하고 입력을 지킨다", () => {
    useEditorStore.setState({ activeTabId: "t1", sourceModeTabs: [] });
    const ed = open("- [ ] 초안");
    fireEvent.change(screen.getByDisplayValue("초안"), {
      target: { value: "고친 초안" },
    });
    // 모달이 떠 있는 동안 전역 단축키로 소스 모드가 켜진다.
    useEditorStore.setState({ sourceModeTabs: ["t1"] });

    fireEvent.click(screen.getByText("Save"));

    expect(markdown(ed)).toBe("- [ ] 초안"); // PM 무변경 — 버퍼와 갈라지지 않는다
    expect(useUIStore.getState().taskEditOpen).toBe(true);
    expect(screen.getByDisplayValue("고친 초안")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  // 이슈 498 (감사 MAJOR): 모달이 열린 동안 Ctrl+Tab 등으로 활성 에디터 인스턴스가
  // 바뀌면(keepalive 전환), open-effect가 재실행되며 보존하겠다던 draft를 새 에디터의
  // 커서 블록으로 갈아치우고, 다음 저장이 다른 문서에 적용될 수 있다. 모달은 처음
  // 캡처한 에디터를 소유해야 한다.
  it("열린 채 에디터 인스턴스가 바뀌면 draft를 갈아치우지 않고 저장을 거부한다", () => {
    const hostA = document.createElement("div");
    document.body.appendChild(hostA);
    editor = new Editor({
      element: hostA,
      extensions: createBaramExtensions(),
    });
    editor.commands.setContent(
      markdownToProsemirror(
        "- [ ] 원래 초안",
        editor.state.schema,
      ).toJSON() as never,
    );
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      if (at === -1 && node.isText) at = pos + 1;
      return at === -1;
    });
    editor.commands.setTextSelection(at);
    useUIStore.setState({ taskEditOpen: true });
    const view = render(
      <EditorProvider value={editor}>
        <TaskEditDialog />
      </EditorProvider>,
    );
    fireEvent.change(screen.getByDisplayValue("원래 초안"), {
      target: { value: "지켜야 할 draft" },
    });

    // 다른 문서를 든 다른 에디터 인스턴스로 전환된다 (keepalive 스왑).
    const hostB = document.createElement("div");
    document.body.appendChild(hostB);
    const editorB = new Editor({
      element: hostB,
      extensions: createBaramExtensions(),
    });
    editorB.commands.setContent(
      markdownToProsemirror(
        "- [ ] 다른 문서",
        editorB.state.schema,
      ).toJSON() as never,
    );
    editorB.commands.setTextSelection(2);
    view.rerender(
      <EditorProvider value={editorB}>
        <TaskEditDialog />
      </EditorProvider>,
    );

    // draft가 다른 문서의 블록으로 갈아치워지지 않았다.
    expect(screen.getByDisplayValue("지켜야 할 draft")).toBeTruthy();

    fireEvent.click(screen.getByText("Save"));
    // 어느 문서에도 쓰이지 않았다.
    expect(markdown(editor!)).toBe("- [ ] 원래 초안");
    expect(markdown(editorB)).toBe("- [ ] 다른 문서");
    expect(useUIStore.getState().taskEditOpen).toBe(true);
    expect(screen.getByRole("alert")).toBeTruthy();
    editorB.destroy();
  });

  // 이슈 498 (감사 MAJOR 후속): 위 두 결함의 조합 — 소스 모드가 켜진 다른 에디터로
  // 스왑되면, 소스 모드 게이트가 owner 검사보다 먼저 닫아 버려 draft가 증발한다.
  // owner 검사가 항상 먼저여야 한다: 남의 에디터 상태로 내 draft를 폐기하지 않는다.
  it("소스 모드인 다른 에디터로 스왑돼도 draft를 폐기하지 않는다", () => {
    const hostA = document.createElement("div");
    document.body.appendChild(hostA);
    editor = new Editor({
      element: hostA,
      extensions: createBaramExtensions(),
    });
    editor.commands.setContent(
      markdownToProsemirror(
        "- [ ] 원래 초안",
        editor.state.schema,
      ).toJSON() as never,
    );
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      if (at === -1 && node.isText) at = pos + 1;
      return at === -1;
    });
    editor.commands.setTextSelection(at);
    useUIStore.setState({ taskEditOpen: true });
    const view = render(
      <EditorProvider value={editor}>
        <TaskEditDialog />
      </EditorProvider>,
    );
    fireEvent.change(screen.getByDisplayValue("원래 초안"), {
      target: { value: "지켜야 할 draft" },
    });

    // 스왑 대상 에디터의 활성 탭은 이미 소스 모드다.
    useEditorStore.setState({ activeTabId: "tB", sourceModeTabs: ["tB"] });
    const hostB = document.createElement("div");
    document.body.appendChild(hostB);
    const editorB = new Editor({
      element: hostB,
      extensions: createBaramExtensions(),
    });
    editorB.commands.setContent(
      markdownToProsemirror(
        "- [ ] 다른 문서",
        editorB.state.schema,
      ).toJSON() as never,
    );
    view.rerender(
      <EditorProvider value={editorB}>
        <TaskEditDialog />
      </EditorProvider>,
    );

    // 조용히 닫혀 draft가 증발하면 안 된다.
    expect(useUIStore.getState().taskEditOpen).toBe(true);
    expect(screen.getByDisplayValue("지켜야 할 draft")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();

    fireEvent.click(screen.getByText("Save"));
    expect(markdown(editor!)).toBe("- [ ] 원래 초안");
    expect(markdown(editorB)).toBe("- [ ] 다른 문서");
    editorB.destroy();
  });

  // 이슈 498: 모달이 떠 있는 동안 문서가 밖에서 바뀌면(전역 단축키·외부 리로드)
  // 캡처된 target이 stale이 된다. 저장은 거부돼야 하고(인접 내용 훼손 금지),
  // 그때 조용히 닫으면 입력한 내용이 통째로 증발하므로 모달은 열린 채 남아야 한다.
  it("문서가 밖에서 바뀌면 저장을 거부하고, 입력을 잃지 않도록 열린 채 알린다", () => {
    const ed = open("- [ ] 초안 쓰기");
    fireEvent.change(screen.getByDisplayValue("초안 쓰기"), {
      target: { value: "고친 초안" },
    });
    // 모달 밖에서 문서가 리로드된다 — 내용이 같아도 모든 노드가 새 객체라
    // 캡처된 target의 identity가 깨진다(외부 파일 변경과 같은 모양).
    const reloaded = markdownToProsemirror("- [ ] 초안 쓰기", ed.state.schema);
    ed.commands.setContent(reloaded.toJSON() as never);
    const before = markdown(ed);

    fireEvent.click(screen.getByText("Save"));

    expect(markdown(ed)).toBe(before); // 문서 무변경 — 인접 내용을 잘라먹지 않았다
    expect(useUIStore.getState().taskEditOpen).toBe(true); // 닫히지 않았다
    expect(screen.getByDisplayValue("고친 초안")).toBeTruthy(); // 입력이 살아 있다
    expect(screen.getByRole("alert")).toBeTruthy(); // 이유가 보인다
  });
});
