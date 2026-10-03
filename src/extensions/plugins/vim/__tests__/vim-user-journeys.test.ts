// §298 issue 776 — end-to-end user journeys through the real vim plugin.
//
// The unit pins elsewhere fix one rule each; these walk the sequences a vim
// user actually types across a mixed document (heading, marks, a list, a code
// block, a table, a wikilink) and check that the session holds together:
// navigation never edits, edits undo cleanly, an insert selection never
// survives Esc, and turning vim off leaves a plain editor. Each journey also
// asserts that its keys took effect, so it cannot pass by doing nothing.

import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../../index";
import { vimPluginKey } from "../vim-keys";

const DOC =
  "<h1>Title</h1><p>abcdefghij</p><p>ab</p>" +
  "<p><strong>bold</strong> line here</p>" +
  "<ul><li><p>list item one</p></li><li><p>two</p></li></ul>" +
  "<pre><code>code line\nsecond</code></pre>" +
  "<table><tr><td><p>c1</p></td><td><p>c2</p></td></tr></table>" +
  "<p>[[note]] tail</p><p>last line</p>";

const editors: Editor[] = [];

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
});

function keys(editor: Editor, ...sequence: string[]): void {
  for (const key of sequence) {
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key,
        shiftKey: key.length === 1 && key !== key.toLowerCase(),
      }),
    );
  }
}

function makeEditor(vim: boolean): Editor {
  const editor = new Editor({
    content: DOC,
    element: document.body.appendChild(document.createElement("div")),
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  if (vim) setVim(editor, true);
  return editor;
}

function mode(editor: Editor): string {
  return (vimPluginKey.getState(editor.state) as unknown as { mode: string })
    .mode;
}

function setVim(editor: Editor, enabled: boolean): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(vimPluginKey, { enabled, type: "setEnabled" }),
  );
}

describe("vim user journeys (issue 776)", () => {
  it("a navigation session moves the cursor everywhere and edits nothing", () => {
    // Fails if: Escape in visual mode stops leaving visual (handleEscape) —
    // the session would end in visual instead of normal.
    const editor = makeEditor(true);
    const before = editor.state.doc.toJSON();
    const visited = new Set<string>();
    editor.on("selectionUpdate", () => {
      const sel = editor.state.selection;
      visited.add(`${sel.from}-${sel.to}`);
    });
    keys(editor, "g", "g");
    keys(editor, "j", "j", "j", "$", "j", "k", "w", "b", "0", "^", "G");
    keys(editor, "g", "g", "4", "j", "l", "l", "h", "f", "e", ";", ",");
    keys(editor, "/", "l", "i", "n", "e", "Enter", "n", "N", "z", "z");
    keys(editor, "v", "j", "j", "Escape", "V", "k", "Escape", ":", "5");
    keys(editor, "Enter");
    expect(editor.state.doc.toJSON()).toEqual(before);
    expect(mode(editor)).toBe("normal");
    expect(visited.size).toBeGreaterThan(15); // the keys really moved it
  });

  it("an editing session lands each edit where vim would, and undo restores it", () => {
    // Fails if: insert Esc stops stepping back onto the last typed unit —
    // the `x` after `XY` Esc would delete "a" instead of "Y".
    const editor = makeEditor(true);
    const before = editor.state.doc.toJSON();
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 8)),
    ); // before "a" of "abcdefghij"
    keys(editor, "i");
    editor.view.dispatch(editor.state.tr.insertText("XY"));
    keys(editor, "Escape", "x");
    expect(mode(editor)).toBe("normal");
    expect(editor.state.doc.child(1).textContent).toBe("Xabcdefghij");

    keys(editor, "d", "d", "o");
    editor.view.dispatch(editor.state.tr.insertText("new"));
    keys(editor, "Escape", "$", "x", "A");
    editor.view.dispatch(editor.state.tr.insertText("!"));
    keys(editor, "Escape");
    // `o` + "new", then `$ x` drops "w" and `A` appends "!".
    expect(editor.state.doc.textContent).toContain("ne!");

    for (let i = 0; i < 20; i++) keys(editor, "u");
    expect(editor.state.doc.toJSON()).toEqual(before);
  });

  it("a selection made in insert mode never survives Esc into the next edit", () => {
    // Fails if: insertEscTarget leaves ranges alone — the range stays, and
    // `i` + typing replaces it instead of inserting one character.
    const editor = makeEditor(true);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 8)),
    );
    keys(editor, "i");
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, 8, 30),
      ),
    );
    keys(editor, "Escape");
    expect(editor.state.selection.empty).toBe(true);
    const length = editor.state.doc.textContent.length;
    keys(editor, "i");
    editor.view.dispatch(editor.state.tr.insertText("Z"));
    keys(editor, "Escape");
    expect(editor.state.doc.textContent.length).toBe(length + 1);
  });

  it("turning vim off mid-session leaves a plain editor; on again, a clean normal", () => {
    // Fails if: enabling vim again does not start from a clean normal core
    // (setEnabled reopening in insert). The two vim-off checks in between are
    // guarded twice — isModal and the clamp both read `enabled` — so no single
    // mutation turns them red; they state the contract.
    const editor = makeEditor(true);
    keys(editor, "j", "j", "v", "j");
    setVim(editor, false);
    expect(editor.view.editable).toBe(true);
    const lineEnd = 17; // after "abcdefghij"
    const { transactions } = editor.state.applyTransaction(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, lineEnd),
      ),
    );
    expect(transactions).toHaveLength(1); // nothing appended
    setVim(editor, true);
    expect(mode(editor)).toBe("normal");
  });

  it("with vim off, a press and Escape leave the editor alone", () => {
    // Fails if: the insert keydown path stops checking that vim is enabled —
    // Escape would run vim's insert Esc and step the caret back.
    const editor = makeEditor(false);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 12)),
    );
    editor.view.dom.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    keys(editor, "Escape");
    expect(editor.state.selection.head).toBe(12);
    editor.view.dispatch(editor.state.tr.insertText("q"));
    expect(editor.state.selection.head).toBe(13);
  });
});
