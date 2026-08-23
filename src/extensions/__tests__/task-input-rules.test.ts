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
  });

  it("does not fire when the trigger is embedded inside a longer word", async () => {
    // small fix #1: 앵커 이전에는 "overdue:8/30 "의 "due:"가 "over" 중간에서
    // 걸려 "over📅2026-08-30 "이 됐다.
    const editor = editorWith(TASK_DOC);
    await type(editor, " overdue:8/30 ");
    expect(editor.getText()).toContain("overdue:8/30");
    expect(editor.getText()).not.toContain("📅");
  });

  it("turns start: and sched: into their own emoji", async () => {
    const a = editorWith(TASK_DOC);
    await type(a, " start:2026-08-25 ");
    expect(a.getText()).toContain("🛫2026-08-25 ");

    const b = editorWith(TASK_DOC);
    await type(b, " sched:2026-08-25 ");
    expect(b.getText()).toContain("⏳2026-08-25 ");
  });

  it("turns !2 into the high priority emoji", async () => {
    const editor = editorWith(TASK_DOC);
    await type(editor, " !2 ");
    expect(editor.getText()).toContain("⏫");
  });

  it("clears prio:3/!3 (normal priority) without inserting an emoji", async () => {
    // small fix #3: 3은 "보통"이라 이모지가 없지만, 트리거는 여전히 지워져야
    // 한다 — registry.json의 "!1-!5" 문구도 이 사실을 반영해 고쳤다.
    const a = editorWith(TASK_DOC);
    await type(a, " prio:3 ");
    expect(a.getText()).not.toContain("prio:");
    expect(a.getText()).not.toMatch(/[🔺⏫🔽⏬]/u);

    const b = editorWith(TASK_DOC);
    await type(b, " !3 ");
    expect(b.getText()).not.toContain("!3");
    expect(b.getText()).not.toMatch(/[🔺⏫🔽⏬]/u);
  });

  it("leaves an unparseable value alone", async () => {
    const editor = editorWith(TASK_DOC);
    await type(editor, " due:내일 ");
    expect(editor.getText()).toContain("due:");
    expect(editor.getText()).not.toContain("📅");
  });

  it("does NOT fire inside a plain paragraph", async () => {
    // 가장 중요한 단언 — 일반 문단의 "회의 due: 내일"을 건드리면 안 된다
    const editor = editorWith("<p>회의 </p>");
    await type(editor, " due:8/30 ");
    expect(editor.getText()).toContain("due:8/30");
    expect(editor.getText()).not.toContain("📅");
  });
});
