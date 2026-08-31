// §5.1 / §18.18 M4 — the task control, from the user's side.
//
// This exercises the real extension stack against real DOM events, because
// every bug this control has ever had lived in the gap between "the command
// works" and "pressing the thing runs the command": the wrong `event.target`,
// a handler on the wrong event, a press that fired the change twice.
import type { Node as PMNode } from "@tiptap/pm/model";

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
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
