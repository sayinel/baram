// §312 ➕ 자동 스탬프 — **언제 붙고 언제 안 붙는지**가 이 기능의 전부다.
//
// 붙는 조건 하나가 느슨해지면 지난달에 쓴 태스크가 오늘 만든 것으로 바뀌고, 빡빡해지면
// 문서에 직접 친 태스크가 다시 배지를 못 받는다. 두 실패 모두 화면에서는 조용하다.

import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";
import { Paragraph } from "../nodes/paragraph";
import { TaskItem } from "../nodes/task-item";
import { TaskList } from "../nodes/task-list";
import { TaskCreatedStamp } from "../plugins/task-created-stamp";

/** 스탬프가 쓰는 것과 같은 "오늘" — 자정을 넘겨 도는 CI에서도 흔들리지 않는다. */
function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const OUTSIDE = "<p>바깥</p>";

function editorWith(html: string): Editor {
  return new Editor({
    content: html,
    extensions: [
      Document,
      Paragraph,
      Text,
      TaskList,
      TaskItem,
      TaskCreatedStamp,
    ],
  });
}

/** 첫 taskItem 문단 안의 위치. */
function inTask(editor: Editor): number {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at === -1 && node.type.name === "taskItem") at = pos + 2;
  });
  return at;
}

/** 태스크 줄 **밖**으로 커서를 옮긴다 — 스탬프를 부르는 유일한 사건이다. */
function leave(editor: Editor): void {
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
}

function task(body: string): string {
  return `<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>${body}</p></li></ul>`;
}

/** 빈 태스크 줄에 커서를 놓고 본문을 친다 — 입력 규칙·Enter가 만드는 상태와 같다. */
function writeNewTask(editor: Editor, body: string): void {
  editor.commands.setTextSelection(inTask(editor));
  editor.commands.insertContent(body);
}

describe("TaskCreatedStamp — §312", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      tasksEnabled: true,
      tasksStampCreatedDate: true,
    });
  });

  afterEach(() => {
    useSettingsStore.setState({
      tasksEnabled: true,
      tasksStampCreatedDate: true,
    });
  });

  it("새로 쓴 태스크 줄을 떠나면 등록일이 붙는다", () => {
    const editor = editorWith(task("") + OUTSIDE);
    writeNewTask(editor, "장보기");
    leave(editor);
    expect(editor.getText()).toContain(`장보기 ➕${today()}`);
    editor.destroy();
  });

  it("커서가 그 줄에 있는 동안에는 붙지 않는다", () => {
    // 붙여 두면 사용자가 원문 그대로의 `➕2026-08-30` 옆에서 타이핑하게 되고,
    // Enter를 치면 커서 뒤의 그 스탬프가 다음 항목으로 잘려 나간다.
    const editor = editorWith(task("") + OUTSIDE);
    writeNewTask(editor, "장보기");
    expect(editor.getText()).not.toContain("➕");
    editor.destroy();
  });

  it("기존 태스크 줄을 고치고 떠나도 붙지 않는다", () => {
    // 지난달에 쓴 줄에 오늘 날짜를 찍으면 그건 거짓말이다. 후보가 되는 것은
    // 커서가 **빈** 태스크 줄에 들어왔을 때뿐이고, 기존 줄은 비어 있지 않다.
    const editor = editorWith(task("지난달에 쓴 것") + OUTSIDE);
    editor.commands.setTextSelection(inTask(editor) + 3);
    editor.commands.insertContent("!");
    leave(editor);
    expect(editor.getText()).not.toContain("➕");
    editor.destroy();
  });

  it("본문 없이 떠난 줄에는 붙지 않는다", () => {
    // `- [ ] `만 치고 나간 자리. 날짜만 남으면 지울 수도 없는 빈 태스크가
    // 배지를 달고 아젠다에 뜬다.
    const editor = editorWith(task("") + OUTSIDE);
    editor.commands.setTextSelection(inTask(editor));
    leave(editor);
    expect(editor.getText()).not.toContain("➕");
    editor.destroy();
  });

  it("이미 등록일이 있으면 하나 더 붙이지 않는다", () => {
    const editor = editorWith(task("") + OUTSIDE);
    writeNewTask(editor, "장보기 ➕2026-01-01");
    leave(editor);
    expect(editor.getText()).toContain("➕2026-01-01");
    expect(editor.getText()).not.toContain(`➕${today()}`);
    editor.destroy();
  });

  it("이모지 필드보다 앞에 들어간다 — §303 순서에서 ➕가 맨 앞이다", () => {
    // 뒤에 붙이면 같은 vault를 Obsidian과 함께 쓰는 사용자에게 보이는 드리프트가 된다.
    const editor = editorWith(task("") + OUTSIDE);
    writeNewTask(editor, "장보기 📅2026-09-01");
    leave(editor);
    expect(editor.getText()).toContain(`장보기 ➕${today()} 📅2026-09-01`);
    editor.destroy();
  });

  it("설정을 끄면 붙지 않는다", () => {
    useSettingsStore.setState({ tasksStampCreatedDate: false });
    const editor = editorWith(task("") + OUTSIDE);
    writeNewTask(editor, "장보기");
    leave(editor);
    expect(editor.getText()).not.toContain("➕");
    editor.destroy();
  });

  it("태스크 기능 자체를 끄면 붙지 않는다", () => {
    // 기능을 통째로 끈 사용자에게 문서만 조용히 바뀌면 설정이 거짓말을 한 것이다.
    useSettingsStore.setState({ tasksEnabled: false });
    const editor = editorWith(task("") + OUTSIDE);
    writeNewTask(editor, "장보기");
    leave(editor);
    expect(editor.getText()).not.toContain("➕");
    editor.destroy();
  });

  it("`[ ] `를 쳐서 만든 줄도 대상이다", async () => {
    // 실제 생성 경로. 여기가 끊기면 나머지 테스트가 다 초록이어도 기능은 없는 것이다.
    const editor = editorWith(`<p></p>${OUTSIDE}`);
    editor.commands.insertContentAt(1, "[ ] ", { applyInputRules: true });
    // 입력 규칙은 다음 macrotask에서 돈다(`task-input-rules.test.ts`와 같은 이유).
    await new Promise((resolve) => setTimeout(resolve, 0));
    editor.commands.insertContent("장보기");
    leave(editor);
    expect(editor.getText()).toContain(`장보기 ➕${today()}`);
    editor.destroy();
  });

  it("Enter로 다음 항목을 만들면 방금 쓴 줄이 스탬프된다", () => {
    // 목록을 이어 쓰는 흔한 경로다. "떠났다"는 사실 하나로 처리되므로 Enter를
    // 위한 훅이 따로 없다 — 그 사실이 실제로 성립하는지가 여기서 갈린다.
    const editor = editorWith(task("") + OUTSIDE);
    writeNewTask(editor, "장보기");
    editor.commands.splitListItem("taskItem");
    expect(editor.getText()).toContain(`장보기 ➕${today()}`);

    // 그리고 새로 생긴 빈 항목이 곧바로 다음 후보가 된다.
    editor.commands.insertContent("빨래");
    leave(editor);
    expect(editor.getText()).toContain(`빨래 ➕${today()}`);
    editor.destroy();
  });

  it("읽기 전용 뷰는 건드리지 않는다", () => {
    // 커서는 읽기 전용 뷰에서도 움직인다. 사용자가 고칠 수 없는 문서를 우리가
    // 고치면 그 변경은 어떤 설정으로도 설명되지 않는다.
    const editor = editorWith(task("") + OUTSIDE);
    writeNewTask(editor, "장보기");
    editor.setEditable(false);
    leave(editor);
    expect(editor.getText()).not.toContain("➕");
    editor.destroy();
  });

  it("두 번 떠나도 한 번만 붙는다", () => {
    const editor = editorWith(task("") + OUTSIDE);
    writeNewTask(editor, "장보기");
    leave(editor);
    editor.commands.setTextSelection(inTask(editor));
    leave(editor);
    expect(editor.getText().match(/➕/g)).toHaveLength(1);
    editor.destroy();
  });
});
