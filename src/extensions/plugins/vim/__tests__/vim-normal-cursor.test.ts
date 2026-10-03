// §298 issue 776 — the normal-mode cursor sits ON a unit (adapters/normal-cursor.ts).
//
// Insert Esc steps one unit back (vim's ins_esc) and a caret left on the
// terminal boundary of a non-empty line is clamped onto the last unit. Each
// pin names the mutation that turns it red.

import { Editor } from "@tiptap/core";
import { AllSelection, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
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

describe("insert Esc leaves a code block's caret alone", () => {
  it("a caret inside a code block does not step back", () => {
    // Fails if: insertEscTarget drops its isCodeBlockLanding check — the
    // caret steps back to 2 and dispatchCursor hands focus to the island.
    const editor = makeVimEditor("<pre><code>abc</code></pre><p>x</p>");
    editor.view.dispatch(
      editor.state.tr
        .setSelection(TextSelection.create(editor.state.doc, 3))
        .setMeta(vimPluginKey, { mode: "insert", type: "setMode" }),
    );
    expect(mode(editor)).toBe("insert");
    key(editor, "Escape");
    expect(mode(editor)).toBe("normal");
    expect(head(editor)).toBe(3);
  });
});

describe("a normal-mode caret on the terminal boundary is clamped", () => {
  it("x on the last character leaves the cursor on the new last one", () => {
    // Fails if: the plugin's appendTransaction (appendNormalCursorFixes) is
    // removed — the caret stays at 3, past "b".
    const editor = makeVimEditor("<p>abc</p>");
    place(editor, 3); // on "c"
    key(editor, "x");
    expect(editor.state.doc.textContent).toBe("ab");
    expect(head(editor)).toBe(2); // on "b"
  });

  it("a selection set past the text (a click) is clamped too", () => {
    // Fails if: appendNormalCursorFixes is removed (head stays 4).
    const editor = makeVimEditor("<p>abc</p>");
    place(editor, 4);
    expect(head(editor)).toBe(3);
  });

  it("does not touch the insert caret at the line end", () => {
    // Fails if: appendNormalCursorFixes drops its `mode === "normal"`
    // condition — typing at the end of a line would jump back one character.
    const editor = makeVimEditor("<p>abc</p>");
    place(editor, 1);
    key(editor, "A");
    expect(mode(editor)).toBe("insert");
    expect(head(editor)).toBe(4);
    editor.view.dispatch(editor.state.tr.insertText("z"));
    expect(head(editor)).toBe(5);
  });

  it("leaves a code block's caret to CodeMirror", () => {
    // Fails if: terminalClampTarget drops its isCodeBlockLanding check
    // (head → 2).
    const editor = makeVimEditor("<pre><code>ab</code></pre><p>x</p>");
    place(editor, 3); // code block content end
    expect(head(editor)).toBe(3);
  });

  it("the empty segment after a hard break keeps its caret too", () => {
    // Fails if: terminalClampTarget drops its "right after a hard break"
    // guard — the unit before is the break itself, and the caret would be
    // pulled onto the previous segment.
    const editor = makeVimEditor("<p>ab<br></p><p>z</p>");
    const afterBreak = editor.state.doc.child(0).nodeSize - 1; // content end
    place(editor, afterBreak);
    expect(head(editor)).toBe(afterBreak);
  });

  it("a caret right before a hard break is a line end and is clamped", () => {
    // Fails if: the O(depth) gate only recognizes the textblock's end.
    const editor = makeVimEditor("<p>ab<br>cd</p>");
    place(editor, 3); // after "b", before the break
    expect(head(editor)).toBe(2); // on "b"
  });

  it("an empty line keeps its caret and appends nothing", () => {
    // Fails if: unitBefore drops `prev < head` — at a line start
    // prevUnitBoundary returns the head itself, so insertEscTarget would
    // return a no-op target and insert Esc at a line start would take the
    // cursor-move path. (The clamp checks `prev < head` itself.)
    const editor = makeVimEditor("<p>a</p><p></p>");
    place(editor, 4);
    expect(head(editor)).toBe(4);
    expect(terminalClampTarget(editor.state)).toBeNull();
    expect(insertEscTarget(editor.state)).toBeNull();
  });
});

describe("insert Esc collapses a range made while inserting", () => {
  function selectThenEscape(editor: Editor, anchor: number, to: number): void {
    place(editor, 1);
    key(editor, "i");
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, anchor, to),
      ),
    );
    key(editor, "Escape");
    expect(mode(editor)).toBe("normal");
  }

  it("a forward range lands on its last unit, and the next i inserts", () => {
    // Fails if: insertEscTarget treats a range like "no move" (null) — the
    // range survives into normal mode and `i` + typing replaces "bc".
    const editor = makeVimEditor("<p>abcd</p>");
    selectThenEscape(editor, 2, 4); // "bc", head after c
    expect(editor.state.selection.empty).toBe(true);
    expect(head(editor)).toBe(3); // on "c"
    key(editor, "i");
    editor.view.dispatch(editor.state.tr.insertText("X"));
    expect(editor.state.doc.textContent).toBe("abXcd");
  });

  it("a backward range lands on the unit at its head", () => {
    // Fails if: a backward range is treated like a forward one (one unit
    // before the head — position 1, "a").
    const editor = makeVimEditor("<p>abcd</p>");
    selectThenEscape(editor, 4, 2); // "bc", head before b
    expect(editor.state.selection.empty).toBe(true);
    expect(head(editor)).toBe(2); // on "b"
  });

  it("a forward range ending at a line start lands on the previous line's last unit", () => {
    // Fails if: lastUnitBefore stops at the head's own line — the head itself
    // ("c", outside the half-open range) would be the landing.
    const editor = makeVimEditor("<p>ab</p><p>cd</p>");
    selectThenEscape(editor, 1, 5); // "ab" + the break, head before "c"
    expect(head(editor)).toBe(2); // on "b"
    key(editor, "i");
    editor.view.dispatch(editor.state.tr.insertText("X"));
    expect(editor.state.doc.child(0).textContent).toBe("aXb");
  });

  it("…and an empty previous line is landed on as such", () => {
    // Fails if: lastUnitBefore drops its empty-line fallback (no unit start
    // there) — it would return null and land on the head again.
    const editor = makeVimEditor("<p>ab</p><p></p><p>cd</p>");
    selectThenEscape(editor, 1, 7); // head before "c"
    expect(head(editor)).toBe(5); // inside the empty paragraph
    expect(editor.state.selection.empty).toBe(true);
  });

  /** Position of the first occurrence of `text`. */
  function at(editor: Editor, text: string): number {
    let found = -1;
    editor.state.doc.descendants((node, pos) => {
      if (found < 0 && node.isText && node.text?.includes(text)) {
        found = pos + (node.text?.indexOf(text) ?? 0);
      }
      return found < 0;
    });
    expect(found).toBeGreaterThan(0);
    return found;
  }

  it("…after a table: the LAST cell's last unit, not the first cell's", () => {
    // Fails if: the predecessor comes from the row-entry line model
    // (collectLines keeps one line per row — the first cell — so the landing
    // was "1", outside the selection's end).
    // The range starts BEFORE the table: one that starts inside a cell is
    // normalized by prosemirror-tables back into that cell.
    const editor = makeVimEditor(
      "<p>top</p><table><tr><td><p>a1</p></td><td><p>b2</p></td></tr></table><p>after</p>",
    );
    selectThenEscape(editor, at(editor, "top"), at(editor, "after"));
    expect(head(editor)).toBe(at(editor, "2"));
  });

  it("…after a code block: skips the block to the text before it", () => {
    // Fails if: lastUnitBefore stops at the code block instead of searching
    // on before it — the landing falls back to the range head, or into the
    // block's source, handing focus to the island.
    const editor = makeVimEditor(
      "<p>para</p><pre><code>xyz</code></pre><p>after</p>",
    );
    selectThenEscape(editor, at(editor, "para"), at(editor, "after"));
    expect(head(editor)).toBe(at(editor, "para") + 3); // para's last "a"
    expect(editor.state.selection.$head.parent.type.name).toBe("paragraph");
  });

  it("…Select All in a document ending with a code block stays out of the block", () => {
    // Fails if: the same code block skip is dropped — an AllSelection's head
    // is the document end, and the fallback near it is the block's source.
    const editor = makeVimEditor("<p>top</p><pre><code>xyz</code></pre>");
    place(editor, 1);
    key(editor, "i");
    editor.view.dispatch(
      editor.state.tr.setSelection(new AllSelection(editor.state.doc)),
    );
    key(editor, "Escape");
    expect(editor.state.selection.$head.parent.type.name).toBe("paragraph");
    expect(head(editor)).toBe(at(editor, "top") + 2); // "top"'s last unit
  });

  it("…a forward cell selection lands in its head cell", () => {
    // A CellSelection's `head` is the end of its range INSIDE the head cell
    // (prosemirror-tables), so the ordinary block search already lands there.
    // Fails if: a forward range collapses toward its anchor instead of its
    // head (the landing would be the first cell).
    const editor = makeVimEditor(
      "<table><tr><td><p>a1</p></td><td><p>b2</p></td></tr></table><p>z</p>",
    );
    place(editor, at(editor, "a1"));
    key(editor, "i");
    const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.spec.tableRole === "cell") cells.push(pos);
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(
        CellSelection.create(editor.state.doc, cells[0], cells[1]),
      ),
    );
    key(editor, "Escape");
    expect(head(editor)).toBe(at(editor, "2"));
  });

  it("…after a hard break: the previous segment's last unit", () => {
    // Fails if: the hard-break branch is dropped — the block-boundary search
    // would jump past the whole paragraph instead.
    const editor = makeVimEditor("<p>ab<br>cd</p>");
    selectThenEscape(editor, at(editor, "ab"), at(editor, "cd"));
    expect(head(editor)).toBe(at(editor, "b"));
  });

  it("…after a block atom: the atom itself", () => {
    // Fails if: the NodeSelection result of the search is not landed on as
    // such (its head points past the node).
    const editor = makeVimEditor("<p>x</p>");
    editor.commands.setContent({
      content: [
        { content: [{ text: "up", type: "text" }], type: "paragraph" },
        { attrs: { latex: "x" }, type: "mathBlock" },
        { content: [{ text: "after", type: "text" }], type: "paragraph" },
      ],
      type: "doc",
    });
    const atomPos = editor.state.doc.child(0).nodeSize;
    selectThenEscape(editor, at(editor, "up"), at(editor, "after"));
    expect(editor.state.selection.from).toBe(atomPos);
  });

  it("a block atom's NodeSelection is kept", () => {
    // Fails if: the NodeSelection exclusion is dropped — the node range is
    // collapsed off the atom line onto text.
    const editor = makeVimEditor("<p>x</p>");
    editor.commands.setContent({
      content: [
        { content: [{ text: "up", type: "text" }], type: "paragraph" },
        { attrs: { latex: "x" }, type: "mathBlock" },
      ],
      type: "doc",
    });
    const atom = editor.state.doc.child(0).nodeSize;
    expect(
      insertEscTarget(
        editor.state.apply(
          editor.state.tr.setSelection(
            NodeSelection.create(editor.state.doc, atom),
          ),
        ),
      ),
    ).toBeNull();
  });
});
