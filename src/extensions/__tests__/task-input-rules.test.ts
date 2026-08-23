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
  it("turns due:8/30 into the due emoji field", async () => {
    const editor = editorWith(TASK_DOC);
    await type(editor, "due:8/30 ");
    expect(editor.getText()).toContain("📅");
    expect(editor.getText()).not.toContain("due:");
  });

  it("turns start: and sched: into their own emoji", async () => {
    const a = editorWith(TASK_DOC);
    await type(a, "start:8/25 ");
    expect(a.getText()).toContain("🛫");

    const b = editorWith(TASK_DOC);
    await type(b, "sched:8/25 ");
    expect(b.getText()).toContain("⏳");
  });

  it("turns !2 into the high priority emoji", async () => {
    const editor = editorWith(TASK_DOC);
    await type(editor, "!2 ");
    expect(editor.getText()).toContain("⏫");
  });

  it("leaves an unparseable value alone", async () => {
    const editor = editorWith(TASK_DOC);
    await type(editor, "due:내일 ");
    expect(editor.getText()).toContain("due:");
    expect(editor.getText()).not.toContain("📅");
  });

  it("does NOT fire inside a plain paragraph", async () => {
    // 가장 중요한 단언 — 일반 문단의 "회의 due: 내일"을 건드리면 안 된다
    const editor = editorWith("<p>회의 </p>");
    await type(editor, "due:8/30 ");
    expect(editor.getText()).toContain("due:8/30");
    expect(editor.getText()).not.toContain("📅");
  });
});
