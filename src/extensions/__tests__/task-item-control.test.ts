// §5.1 / §18.18 M4 — the task control, from the user's side.
//
// This exercises the real extension stack against real DOM events, because
// every bug this control has ever had lived in the gap between "the command
// works" and "pressing the thing runs the command": the wrong `event.target`,
// a handler on the wrong event, a press that fired the change twice.
import type { Node as PMNode } from "@tiptap/pm/model";

import { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { afterEach, describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import { useSettingsStore } from "../../stores/settings/store";
import { createBaramExtensions } from "../index";

const editors: Editor[] = [];

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
});

function boxes(editor: Editor): HTMLElement[] {
  return [...editor.view.dom.querySelectorAll<HTMLElement>(".task-checkbox")];
}

function createEditor(md: string): Editor {
  const editor = new Editor({
    content: "",
    extensions: createBaramExtensions(),
  });
  editor.commands.setContent(markdownToProsemirror(md, editor.schema).toJSON());
  editors.push(editor);
  return editor;
}

function press(el: HTMLElement, type: "click" | "mousedown"): void {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
}

function states(doc: PMNode): string[] {
  const out: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === "taskItem") out.push(node.attrs.state as string);
    return true;
  });
  return out;
}

describe("the task control renders its state", () => {
  it("puts the state on the item and on the control", () => {
    const editor = createEditor("- [ ] a\n- [/] b\n- [x] c\n- [-] d\n");
    const items = [
      ...editor.view.dom.querySelectorAll('li[data-type="taskItem"]'),
    ];
    expect(items.map((li) => li.getAttribute("data-state"))).toEqual([
      "todo",
      "doing",
      "done",
      "cancelled",
    ]);
    expect(boxes(editor).map((b) => b.getAttribute("data-state"))).toEqual([
      "todo",
      "doing",
      "done",
      "cancelled",
    ]);
  });

  // The control has no text, so its accessible name is the only thing a screen
  // reader can announce. `role="checkbox"` is deliberately absent — its
  // `mixed` value stops at three states — which makes the name the ENTIRE
  // accessibility story for a four-state control.
  it("names the current state, so it is not an unlabelled button", () => {
    const editor = createEditor("- [/] b\n");
    const label = boxes(editor)[0].getAttribute("aria-label");
    expect(label).toBeTruthy();
    expect(label).not.toBe("");
  });

  it("also writes `data-checked`, so other tiptap editors can read our export", () => {
    const editor = createEditor("- [x] c\n- [/] b\n");
    const items = [
      ...editor.view.dom.querySelectorAll('li[data-type="taskItem"]'),
    ];
    // Only `done` is checked. A `doing` item is NOT a kind of done — a reader
    // that only knows the boolean must see it as open, not as complete.
    expect(items.map((li) => li.getAttribute("data-checked"))).toEqual([
      "true",
      "false",
    ]);
  });
});

describe("pressing the task control", () => {
  it("cycles todo → doing → done → todo", () => {
    const editor = createEditor("- [ ] a\n");
    const box = boxes(editor)[0];

    press(box, "click");
    expect(states(editor.state.doc)).toEqual(["doing"]);
    press(boxes(editor)[0], "click");
    expect(states(editor.state.doc)).toEqual(["done"]);
    press(boxes(editor)[0], "click");
    expect(states(editor.state.doc)).toEqual(["todo"]);
  });

  it("re-opens a cancelled task rather than ignoring the press", () => {
    const editor = createEditor("- [-] d\n");
    press(boxes(editor)[0], "click");
    expect(states(editor.state.doc)).toEqual(["todo"]);
  });

  // ‼️ A real mouse press fires mousedown AND click. `mousedown` is here only
  // to stop the caret being taken from the line being edited; if it ALSO
  // changed the state, every mouse click would advance two steps while a
  // keyboard Enter advanced one — and the state under the pointer would be the
  // one the user did not choose.
  it("advances exactly one step for a full mouse press", () => {
    const editor = createEditor("- [ ] a\n");
    const box = boxes(editor)[0];
    press(box, "mousedown");
    expect(states(editor.state.doc)).toEqual(["todo"]);
    press(box, "click");
    expect(states(editor.state.doc)).toEqual(["doing"]);
  });

  it("changes only the INNERMOST item of a nested list", () => {
    const editor = createEditor("- [ ] outer\n  - [ ] inner\n");
    // Document order: outer first, inner second.
    press(boxes(editor)[1], "click");
    expect(states(editor.state.doc)).toEqual(["todo", "doing"]);
  });

  it("does nothing while the editor is read-only", () => {
    const editor = createEditor("- [ ] a\n");
    editor.setEditable(false);
    press(boxes(editor)[0], "click");
    expect(states(editor.state.doc)).toEqual(["todo"]);
  });

  it("leaves an ordinary click in the text alone", () => {
    const editor = createEditor("- [ ] a\n");
    const text = editor.view.dom.querySelector("li > div") as HTMLElement;
    press(text, "click");
    expect(states(editor.state.doc)).toEqual(["todo"]);
  });

  // The point of the whole slice: the state the user pressed into is the state
  // the file gets, without anyone having to type a marker.
  it("saves the state it cycled to", () => {
    const editor = createEditor("- [ ] a\n");
    press(boxes(editor)[0], "click");
    expect(prosemirrorToMarkdown(editor.state.doc)).toBe("- [/] a\n");
  });
});

describe("the cancel path", () => {
  it("writes `[-]` through the command the slash menu calls", () => {
    const editor = createEditor("- [ ] a\n");
    editor.commands.focus("end");
    expect(editor.commands.setTaskState("cancelled")).toBe(true);
    expect(prosemirrorToMarkdown(editor.state.doc)).toBe("- [-] a\n");
  });

  it("refuses off a task line, so the menu entry cannot half-fire", () => {
    const editor = createEditor("plain line\n");
    editor.commands.focus("end");
    expect(editor.commands.setTaskState("cancelled")).toBe(false);
  });
});

// §18.18 M4 시간 기록 — 사용자가 고른 것은 "상태와 연동"이다(2026-08-31). 그래서 이
// 스위트는 **체크박스 한 번**이 상태와 `⏱`를 함께 옮기는지, 그 결과가 파일에 그대로
// 적히는지를 본다. 값 문법 자체는 `task-timer.test.ts`가 따로 못박는다.
describe("the state ring moves the clock", () => {
  function trackTime(on: boolean): void {
    useSettingsStore.getState().setTasksTrackTime(on);
  }

  afterEach(() => trackTime(false));

  // ‼️ 기본은 꺼져 있다. `➕`·`✅`와 갈리는 자리다 — 그 둘에 기대는 기능이 있지만
  // `⏱`에 기대는 것은 아직 없고, 켜져 있으면 태스크를 진행 중으로 옮기는 것만으로
  // 사용자 파일에 새 필드가 적힌다.
  it("writes nothing while tracking is off", () => {
    const editor = createEditor("- [ ] a\n");
    press(boxes(editor)[0], "click");
    expect(prosemirrorToMarkdown(editor.state.doc)).toBe("- [/] a\n");
  });

  it("starts the clock when the task becomes `doing`", () => {
    trackTime(true);
    const editor = createEditor("- [ ] a\n");
    press(boxes(editor)[0], "click");

    const md = prosemirrorToMarkdown(editor.state.doc);
    expect(md).toMatch(/^- \[\/\] a ⏱0m\+\d{4}-\d{2}-\d{2}T\d{2}:\d{2}\n$/);
  });

  it("banks the stretch when it leaves `doing`", () => {
    trackTime(true);
    const editor = createEditor("- [/] a ⏱1h27m+2026-08-31T14:03\n");
    // 두 번째 걸음: 진행 중 → 완료.
    press(boxes(editor)[0], "click");

    const md = prosemirrorToMarkdown(editor.state.doc);
    expect(md).toContain("- [x] a ⏱");
    expect(md).not.toContain("+2026");
  });

  // ‼️ 한 번의 누름이 두 가지를 바꾸므로, 되돌리기도 한 번이어야 한다. 트랜잭션이
  // 둘이면 Ctrl+Z가 절반만 되돌려 상태와 타이머가 어긋난 줄이 남는다.
  it("undoes the state and the clock together", () => {
    trackTime(true);
    const editor = createEditor("- [ ] a\n");
    editor.commands.focus("end");
    // 하네스 인공물 가드: `setContent`와 이 누름이 하나의 history 그룹에 들어가면
    // (`newGroupDelay`) `u` 한 번이 문서를 통째로 비운다.
    editor.view.dispatch(closeHistory(editor.state.tr));
    press(boxes(editor)[0], "click");
    expect(prosemirrorToMarkdown(editor.state.doc)).toContain("⏱");

    editor.commands.undo();
    expect(prosemirrorToMarkdown(editor.state.doc)).toBe("- [ ] a\n");
  });

  it("keeps the clock out of the way of the other fields", () => {
    trackTime(true);
    const editor = createEditor("- [ ] a 📅2026-09-01 ⏫ 🔁every week\n");
    press(boxes(editor)[0], "click");

    // §303 순서: 날짜 → 우선순위 → 시간 → 반복. 반복은 값이 줄 끝까지라 반드시 마지막이고,
    // ⏱가 그 뒤로 가면 인덱서가 그것을 반복 규칙의 일부로 읽는다.
    expect(prosemirrorToMarkdown(editor.state.doc)).toMatch(
      /^- \[\/\] a 📅2026-09-01 ⏫ ⏱0m\+[\d-]+T[\d:]+ 🔁every week\n$/,
    );
  });
});

// §318 — 반복 태스크를 완료로 넘기면 그 자리에서 다음 회차가 된다.
//
// ‼️ 여기 적힌 두 줄(입력·기대)은 Rust `write.rs`의
// `a_roll_moves_every_date_it_is_given`가 **같은 문자열로** 단정한다. 두 진입점이
// 갈라져 있으므로(에디터는 PM 트랜잭션, 아젠다는 디스크) 어느 한쪽만 고치면 같은
// 조작이 표면에 따라 다른 줄을 만든다 — 그 사고를 두 언어의 테스트가 막는다.
describe("a recurring task rolls instead of completing (§318)", () => {
  it("moves the dates and comes back to todo in one press", () => {
    const editor = createEditor(
      "- [/] 주간 회고 🛫2026-08-30 📅2026-09-01 🔁every week\n",
    );

    press(boxes(editor)[0], "click");

    expect(states(editor.state.doc)).toEqual(["todo"]);
    expect(prosemirrorToMarkdown(editor.state.doc)).toBe(
      "- [ ] 주간 회고 🛫2026-09-06 📅2026-09-08 🔁every week\n",
    );
  });

  // 취소는 "이번 회차를 건너뛴다"이지 "반복을 끝낸다"가 아니다.
  it("rolls on cancel as well", () => {
    const editor = createEditor("- [ ] 주간 회고 📅2026-09-01 🔁every week\n");

    editor.commands.setTaskState("cancelled");

    expect(prosemirrorToMarkdown(editor.state.doc)).toBe(
      "- [ ] 주간 회고 📅2026-09-08 🔁every week\n",
    );
  });

  // ‼️ 굴린 줄에 ✅이 남으면 그 줄은 자기가 끝났는지에 대해 두 가지를 말한다.
  it("strips a completion stamp the line was carrying", () => {
    const editor = createEditor(
      "- [/] 주간 회고 📅2026-09-01 🔁every week ✅2026-08-25\n",
    );

    press(boxes(editor)[0], "click");

    expect(prosemirrorToMarkdown(editor.state.doc)).toBe(
      "- [ ] 주간 회고 📅2026-09-08 🔁every week\n",
    );
  });

  // 한 번의 Ctrl+Z가 절반만 되돌리면 안 된다 — 상태는 굴렀는데 날짜는 안 굴린 줄.
  it("undoes as a single step", () => {
    const md = "- [/] 주간 회고 📅2026-09-01 🔁every week\n";
    const editor = createEditor(md);
    editor.view.dispatch(closeHistory(editor.state.tr));

    press(boxes(editor)[0], "click");
    editor.commands.undo();

    expect(prosemirrorToMarkdown(editor.state.doc)).toBe(md);
  });

  it.each([
    ["a rule it cannot read", "- [/] a 📅2026-09-01 🔁every fortnight\n", "- [x] a 📅2026-09-01 🔁every fortnight\n"],
    ["no date to move", "- [/] a 🔁every 3 days\n", "- [x] a 🔁every 3 days\n"],
    ["no recurrence at all", "- [/] a 📅2026-09-01\n", "- [x] a 📅2026-09-01\n"],
  ])("completes normally with %s", (_label, md, expected) => {
    const editor = createEditor(md);

    press(boxes(editor)[0], "click");

    expect(prosemirrorToMarkdown(editor.state.doc)).toBe(expected);
  });
});
