import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { describe, expect, it } from "vitest";

import { Paragraph } from "../nodes/paragraph";
import { TaskItem } from "../nodes/task-item";
import { TaskList } from "../nodes/task-list";
import { TaskInputRules } from "../plugins/task-input-rules";

function editorWith(html: string): Editor {
  return new Editor({
    extensions: [Document, Paragraph, Text, TaskList, TaskItem, TaskInputRules],
    content: html,
  });
}

const TASK_DOC =
  '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>본문 </p></li></ul>';

/**
 * 입력 규칙을 실제로 발동시키며 텍스트를 넣는다.
 *
 * Tiptap의 `insertContentAt`은 `applyInputRules` 옵션을 지원한다
 * (`@tiptap/core`의 `InsertContentOptions`). 같은 파일 계열의
 * `src/extensions/__tests__/block-reference-rules.test.ts`가 paste rule에 대해
 * `applyPasteRules: true`로 같은 패턴을 쓴다 — 그 선례를 따른다.
 *
 * 다만 input rule 쪽은 동기적으로 끝나지 않는다: `applyInputRules: true`는
 * `tr.setMeta('applyInputRules', ...)`만 남기고, 실제 규칙 매칭은
 * `@tiptap/core`의 `InputRule.ts`(`inputRulesPlugin`의 `apply()`)가
 * `setTimeout(() => run(...))`으로 다음 macrotask에서 수행한다. 그래서 이
 * 헬퍼는 async로 만들고 그 tick을 흘려보낸 뒤에 반환한다 — 그러지 않으면
 * 어서션 시점에 규칙이 아직 발동하지 않은 상태를 보게 된다.
 */
async function type(editor: Editor, text: string): Promise<void> {
  editor.commands.focus("end");
  const pos = editor.state.selection.from;
  editor.commands.insertContentAt(pos, text, { applyInputRules: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("TaskInputRules", () => {
  // TASK_DOC의 "본문 " 뒤 공백은 HTML 파싱 단계에서 사라진다(ProseMirror가
  // 블록 끝 공백을 접는다) — 그래서 여기서는 구분 공백을 typed 문자열 맨
  // 앞에 넣어 실제 타이핑(트랜잭션으로 들어가는 문자)으로 만든다.
  it("turns due:2026-08-30 into the exact due emoji field", async () => {
    // small fix #2: toContain("📅")만으로는 해석된 날짜가 틀려도 통과한다 —
    // 전체 필드 문자열(이모지+값)을 단언한다. ISO 값을 쓰는 이유는 "오늘"
    // 의존 없이 결정론적인 결과를 얻기 위해서다(M/D 값은 resolveDateInput이
    // "오늘" 기준 연도를 고른다 — 테스트를 실행하는 실제 날짜에 따라
    // 결과가 달라진다).
    const editor = editorWith(TASK_DOC);
    await type(editor, " due:2026-08-30 ");
    expect(editor.getText()).toContain("📅2026-08-30 ");
    expect(editor.getText()).not.toContain("due:");
    editor.destroy();
  });

  it("does not fire when the trigger is embedded inside a longer word", async () => {
    // small fix #1: 앵커 이전에는 "overdue:8/30 "의 "due:"가 "over" 중간에서
    // 걸려 "over📅2026-08-30 "이 됐다.
    const editor = editorWith(TASK_DOC);
    await type(editor, " overdue:8/30 ");
    expect(editor.getText()).toContain("overdue:8/30");
    expect(editor.getText()).not.toContain("📅");
    editor.destroy();
  });

  it("turns start: and sched: into their own emoji", async () => {
    const a = editorWith(TASK_DOC);
    await type(a, " start:2026-08-25 ");
    expect(a.getText()).toContain("🛫2026-08-25 ");
    a.destroy();

    const b = editorWith(TASK_DOC);
    await type(b, " sched:2026-08-25 ");
    expect(b.getText()).toContain("⏳2026-08-25 ");
    b.destroy();
  });

  it("turns !2 into the high priority emoji", async () => {
    const editor = editorWith(TASK_DOC);
    await type(editor, " !2 ");
    expect(editor.getText()).toContain("⏫");
    editor.destroy();
  });

  it("clears prio:3/!3 (normal priority) without inserting an emoji", async () => {
    // small fix #3: 3은 "보통"이라 이모지가 없지만, 트리거는 여전히 지워져야
    // 한다 — registry.json의 "!1-!5" 문구도 이 사실을 반영해 고쳤다.
    const a = editorWith(TASK_DOC);
    await type(a, " prio:3 ");
    expect(a.getText()).not.toContain("prio:");
    expect(a.getText()).not.toMatch(/[🔺⏫🔽⏬]/u);
    a.destroy();

    const b = editorWith(TASK_DOC);
    await type(b, " !3 ");
    expect(b.getText()).not.toContain("!3");
    expect(b.getText()).not.toMatch(/[🔺⏫🔽⏬]/u);
    b.destroy();
  });

  it("leaves an unparseable value alone", async () => {
    const editor = editorWith(TASK_DOC);
    await type(editor, " due:내일 ");
    expect(editor.getText()).toContain("due:");
    expect(editor.getText()).not.toContain("📅");
    editor.destroy();
  });

  it("does NOT fire inside a plain paragraph", async () => {
    // 가장 중요한 단언 — 일반 문단의 "회의 due: 내일"을 건드리면 안 된다
    const editor = editorWith("<p>회의 </p>");
    await type(editor, " due:8/30 ");
    expect(editor.getText()).toContain("due:8/30");
    expect(editor.getText()).not.toContain("📅");
    editor.destroy();
  });
});

/**
 * 실제 Enter 키를 keymap/input-rule 플러그인 체인에 그대로 흘려보낸다.
 *
 * `view.someProp("handleKeyDown", ...)`는 ProseMirror가 keydown에서 쓰는 바로
 * 그 순회다 — 플러그인 등록 순서까지 실제와 같다. 이 결함의 핵심이 "입력 규칙
 * 플러그인이 keymap보다 먼저 Enter를 가져간다"는 순서 문제라서, 규칙 핸들러를
 * 직접 호출해서는 재현되지 않는다.
 *
 * 반환값은 "누군가 Enter를 처리했는가"다.
 */
function pressEnter(editor: Editor): boolean {
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
  return (
    editor.view.someProp("handleKeyDown", (f) => f(editor.view, event)) === true
  );
}

function taskDocWith(text: string): Editor {
  return editorWith(
    `<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>${text}</p></li></ul>`,
  );
}

/** taskItem별 텍스트 — 문서 구조를 그대로 읽는다. */
function taskItemTexts(editor: Editor): string[] {
  const texts: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "taskItem") texts.push(node.textContent);
  });
  return texts;
}

describe("TaskInputRules — 줄 끝 트리거에서의 Enter (§303)", () => {
  it("Enter 한 번이 변환과 줄 나눔을 함께 한다", () => {
    // 측정된 결함: 규칙이 `\s$`의 `\s`로 Enter의 `\n`을 먹으면서 변환만 하고
    // 줄은 나누지 않았다 — 새 항목을 얻으려면 Enter를 두 번 쳐야 했다.
    const editor = taskDocWith("a due:2026-08-30");
    editor.commands.focus("end");

    expect(pressEnter(editor)).toBe(true);

    expect(taskItemTexts(editor)).toEqual(["a 📅2026-08-30", ""]);
    editor.destroy();
  });

  it.each([
    ["sched", "a sched:2026-08-30", "a ⏳2026-08-30"],
    ["start", "a start:2026-08-30", "a 🛫2026-08-30"],
    ["prio:N", "a prio:2", "a ⏫"],
    ["!N", "a !2", "a ⏫"],
  ])("같은 모양이 %s 에서도 고쳐져 있다", (_, typed, converted) => {
    const editor = taskDocWith(typed);
    editor.commands.focus("end");

    expect(pressEnter(editor)).toBe(true);

    expect(taskItemTexts(editor)).toEqual([converted, ""]);
    editor.destroy();
  });

  it("이모지가 없는 prio:3 도 트리거만 지우고 줄을 나눈다", () => {
    const editor = taskDocWith("a prio:3");
    editor.commands.focus("end");

    expect(pressEnter(editor)).toBe(true);

    const texts = taskItemTexts(editor);
    expect(texts).toHaveLength(2);
    expect(texts[0].trimEnd()).toBe("a");
    expect(texts[1]).toBe("");
    editor.destroy();
  });

  it("트리거가 없으면 평소대로 항목만 나뉜다", () => {
    const editor = taskDocWith("a");
    editor.commands.focus("end");

    expect(pressEnter(editor)).toBe(true);

    expect(taskItemTexts(editor)).toEqual(["a", ""]);
    editor.destroy();
  });

  it("해석되지 않는 값은 Enter를 삼키지 않는다", () => {
    const editor = taskDocWith("a due:내일");
    editor.commands.focus("end");

    expect(pressEnter(editor)).toBe(true);

    expect(taskItemTexts(editor)).toEqual(["a due:내일", ""]);
    editor.destroy();
  });

  it("일반 문단의 Enter는 변환도 지연도 없이 그대로 나뉜다", () => {
    const editor = editorWith("<p>회의 due:2026-08-30</p>");
    editor.commands.focus("end");

    expect(pressEnter(editor)).toBe(true);

    const paragraphs: string[] = [];
    editor.state.doc.forEach((node) => paragraphs.push(node.textContent));
    expect(paragraphs).toEqual(["회의 due:2026-08-30", ""]);
    editor.destroy();
  });
});
