// §298 issue 776 — the normal-mode cursor sits ON a unit (adapters/normal-cursor.ts).
//
// Insert Esc steps one unit back (vim's ins_esc) and a caret left on the
// terminal boundary of a non-empty line is clamped onto the last unit. Each
// pin names the mutation that turns it red.

import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../../index";
import {
  insertEscTarget,
  terminalClampTarget,
} from "../adapters/normal-cursor";
import { resetVimRegister } from "../adapters/register";
import { vimPluginKey } from "../vim-keys";
import { type VimPluginState } from "../vim-plugin-state";

const editors: Editor[] = [];

afterEach(() => {
  resetVimRegister();
  for (const e of editors.splice(0)) e.destroy();
});

function head(editor: Editor): number {
  return editor.state.selection.head;
}

function key(editor: Editor, key: string): void {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }),
  );
}

function makeVimEditor(content: string): Editor {
  const editor = new Editor({ content, extensions: createBaramExtensions() });
  editors.push(editor);
  editor.view.dispatch(
    editor.state.tr.setMeta(vimPluginKey, {
      enabled: true,
      type: "setEnabled",
    }),
  );
  return editor;
}

function mode(editor: Editor): VimPluginState["mode"] {
  return (vimPluginKey.getState(editor.state) as unknown as VimPluginState)
    .mode;
}

function place(editor: Editor, pos: number): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
  );
}

/** `i` at `pos`, type `text`, Esc. */
function insertThenEscape(editor: Editor, pos: number, text: string): void {
  place(editor, pos);
  key(editor, "i");
  expect(mode(editor)).toBe("insert");
  if (text !== "") editor.view.dispatch(editor.state.tr.insertText(text));
  key(editor, "Escape");
  expect(mode(editor)).toBe("normal");
}

describe("insert Esc steps one unit back (vim ins_esc)", () => {
  it("lands ON the last typed character", () => {
    // Fails if: Esc only flips the mode (the caret stays after "Y", at 6).
    const editor = makeVimEditor("<p>abcd</p>");
    insertThenEscape(editor, 3, "XY");
    expect(editor.state.doc.textContent).toBe("abXYcd");
    expect(head(editor)).toBe(4); // on "Y"
  });

  it("steps over a whole NFD hangul syllable, not one code point", () => {
    // Fails if: the step is `head - 1` instead of prevUnitBoundary.
    const nfd = "한"; // 한, three code points
    const editor = makeVimEditor("<p>ab</p>");
    insertThenEscape(editor, 2, nfd); // before "b"
    expect(head(editor)).toBe(2); // the syllable's start, not 4
  });

  it("stays put at the start of a hard-break segment", () => {
    // Fails if: unitBefore drops `prev >= lineStart` — the step crosses the
    // break onto the previous segment (position 2).
    const editor = makeVimEditor("<p>a<br>b</p>");
    insertThenEscape(editor, 3, "");
    expect(head(editor)).toBe(3);
  });
});

describe("a normal-mode caret on the terminal boundary is clamped", () => {
  it("x on the last character leaves the cursor on the new last one", () => {
    // Fails if: the plugin's appendTransaction (clampNormalCaret) is removed —
    // the caret stays at 3, past "b".
    const editor = makeVimEditor("<p>abc</p>");
    place(editor, 3); // on "c"
    key(editor, "x");
    expect(editor.state.doc.textContent).toBe("ab");
    expect(head(editor)).toBe(2); // on "b"
  });

  it("a selection set past the text (a click) is clamped too", () => {
    // Fails if: clampNormalCaret is removed (head stays 4).
    const editor = makeVimEditor("<p>abc</p>");
    place(editor, 4);
    expect(head(editor)).toBe(3);
  });

  it("does not touch the insert caret at the line end", () => {
    // Fails if: clampNormalCaret drops its `mode !== "normal"` guard — typing
    // at the end of a line would jump back one character.
    const editor = makeVimEditor("<p>abc</p>");
    place(editor, 1);
    key(editor, "A");
    expect(mode(editor)).toBe("insert");
    expect(head(editor)).toBe(4);
    editor.view.dispatch(editor.state.tr.insertText("z"));
    expect(head(editor)).toBe(5);
  });

  it("leaves a code block's caret to CodeMirror", () => {
    // Fails if: caretSpan drops the isCodeBlockLanding exclusion (head → 2).
    const editor = makeVimEditor("<pre><code>ab</code></pre><p>x</p>");
    place(editor, 3); // code block content end
    expect(head(editor)).toBe(3);
  });

  it("an empty line keeps its caret and appends nothing", () => {
    // Fails if: unitBefore drops `prev < head` — at a line start
    // prevUnitBoundary returns the head itself, so the clamp would append a
    // no-op selection transaction on every transaction that lands on an empty
    // line, and insert Esc at a line start would take the cursor-move path.
    const editor = makeVimEditor("<p>a</p><p></p>");
    place(editor, 4);
    expect(head(editor)).toBe(4);
    expect(terminalClampTarget(editor.state)).toBeNull();
    expect(insertEscTarget(editor.state)).toBeNull();
  });
});
