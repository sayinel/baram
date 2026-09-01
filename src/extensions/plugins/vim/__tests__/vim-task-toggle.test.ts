// §298 — normal-mode Space toggles the task-list checkbox under the vim
// cursor (external review request: there was no keyboard way to complete a
// checklist item while vim owns the surface — normal mode swallows every
// unmapped printable, so Space was a dead key).
//
// Semantics: nearest ancestor taskItem of the vim head advances one step; a
// plain line consumes the key silently (vim-like); visual mode is untouched.
//
// ‼️ §18.18 M4 made the step a 3-state CYCLE (todo → doing → done → todo), not
// a flip. The key deliberately walks the same `nextTaskState` ring as the
// checkbox click — if the two ever disagree about what one press means, the
// same document reacts differently to the mouse and to the keyboard.

import type { Node as PMNode } from "@tiptap/pm/model";

import { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../../../pipeline/md-to-pm";
import { createBaramExtensions } from "../../../index";
import { vimPluginKey } from "../vim-keys";

const editors: Editor[] = [];

function createEditor(md: string): Editor {
  const editor = new Editor({
    content: "",
    extensions: createBaramExtensions(),
  });
  const doc = markdownToProsemirror(md, editor.schema);
  editor.commands.setContent(doc.toJSON());
  editors.push(editor);
  return editor;
}

function states(doc: PMNode): string[] {
  const out: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === "taskItem") out.push(node.attrs.state as string);
    return true;
  });
  return out;
}

/** Doc position of the first occurrence of `text` (start of the match). */
function posOfText(doc: PMNode, text: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText && node.text && node.text.includes(text)) {
      found = pos + node.text.indexOf(text);
    }
    return true;
  });
  if (found < 0) throw new Error(`text not found: ${text}`);
  return found;
}

function press(editor: Editor, key: string): void {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
  );
}

function putCursorAt(editor: Editor, text: string): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, posOfText(editor.state.doc, text)),
    ),
  );
}

function setVim(editor: Editor, enabled: boolean): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(vimPluginKey, { enabled, type: "setEnabled" }),
  );
}

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
});

describe("vim normal-mode Space toggles task items (§298)", () => {
  it("walks the item under the cursor all the way round the ring", () => {
    const editor = createEditor("- [ ] alpha\n- [x] beta\n");
    setVim(editor, true);
    putCursorAt(editor, "alpha");

    press(editor, " ");
    expect(states(editor.state.doc)).toEqual(["doing", "done"]);

    press(editor, " ");
    expect(states(editor.state.doc)).toEqual(["done", "done"]);

    // Back to the start — the ring closes, so no state is a dead end.
    press(editor, " ");
    expect(states(editor.state.doc)).toEqual(["todo", "done"]);
  });

  it("only the item under the cursor changes", () => {
    const editor = createEditor("- [ ] alpha\n- [x] beta\n");
    setVim(editor, true);
    putCursorAt(editor, "beta");
    press(editor, " ");
    expect(states(editor.state.doc)).toEqual(["todo", "todo"]);
  });

  it("nested lists: the INNERMOST task item toggles", () => {
    const editor = createEditor("- [ ] outer\n  - [ ] inner\n");
    setVim(editor, true);
    putCursorAt(editor, "inner");
    press(editor, " ");
    // Document order: outer first, inner second.
    expect(states(editor.state.doc)).toEqual(["todo", "doing"]);
  });

  it("a plain paragraph consumes Space without changing the document", () => {
    const editor = createEditor("plain line\n\n- [ ] alpha\n");
    setVim(editor, true);
    putCursorAt(editor, "plain");
    const before = editor.state.doc.toJSON();
    press(editor, " ");
    expect(editor.state.doc.toJSON()).toEqual(before);
  });

  it("visual mode Space does not toggle", () => {
    const editor = createEditor("- [ ] alpha\n");
    setVim(editor, true);
    putCursorAt(editor, "alpha");
    press(editor, "v");
    press(editor, " ");
    expect(states(editor.state.doc)).toEqual(["todo"]);
  });

  it("vim `u` undoes the toggle", () => {
    const editor = createEditor("- [ ] alpha\n");
    setVim(editor, true);
    putCursorAt(editor, "alpha");
    // Harness artifact guard: setContent and the toggle would otherwise
    // land in ONE history group (newGroupDelay), making `u` wipe both.
    editor.view.dispatch(closeHistory(editor.state.tr));
    press(editor, " ");
    expect(states(editor.state.doc)).toEqual(["doing"]);
    press(editor, "u");
    expect(states(editor.state.doc)).toEqual(["todo"]);
  });
});
