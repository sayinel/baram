// §298 issue 776 — the normal-mode cursor sits ON a unit (adapters/normal-cursor.ts).
//
// Insert Esc steps one unit back (vim's ins_esc) and a caret left on the
// terminal boundary of a non-empty line is clamped onto the last unit. Each
// pin names the mutation that turns it red.

import type { VimPluginState } from "../vim-plugin-state";
import type { DecorationSet } from "@tiptap/pm/view";

import { Editor } from "@tiptap/core";
import { AllSelection, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "../../../index";
import * as cmRegistry from "../../../nodes/views/code-block-cm-registry";
import {
  insertEscTarget,
  terminalClampTarget,
} from "../adapters/normal-cursor";
import { resetVimRegister } from "../adapters/register";
import { vimPluginKey } from "../vim-keys";

const editors: Editor[] = [];

afterEach(() => {
  vi.restoreAllMocks();
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
    // Fails if: Esc only flips the mode (the caret stays after "Y", at 5).
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
    // Fails if: unitBeforeOnLine drops `prev >= lineStart` — the step crosses the
    // break onto the previous segment (position 2).
    const editor = makeVimEditor("<p>a<br>b</p>");
    insertThenEscape(editor, 3, "");
    expect(head(editor)).toBe(3);
  });
});

describe("insert Esc leaves a code block's caret alone", () => {
  it("a caret inside a code block does not step back", () => {
    // Fails if: escapeInsertCursor sends a null target through dispatchCursor:
    // enterCodeBlockSelection is called for the unchanged code-block caret.
    const editor = makeVimEditor("<pre><code>abc</code></pre><p>x</p>");
    editor.view.dispatch(
      editor.state.tr
        .setSelection(TextSelection.create(editor.state.doc, 3))
        .setMeta(vimPluginKey, { mode: "insert", type: "setMode" }),
    );
    expect(mode(editor)).toBe("insert");
    const handoff = vi.spyOn(cmRegistry, "enterCodeBlockSelection");
    key(editor, "Escape");
    expect(handoff).not.toHaveBeenCalled();
    expect(mode(editor)).toBe("normal");
    expect(head(editor)).toBe(3);
  });
});

describe("a normal-mode caret on the terminal boundary is clamped", () => {
  it("x on the last character leaves the cursor on the new last one", () => {
    // Fails if: the plugin's appendTransaction (appendClampAndGoalReset) is
    // removed — the caret stays at 3, past "b".
    const editor = makeVimEditor("<p>abc</p>");
    place(editor, 3); // on "c"
    key(editor, "x");
    expect(editor.state.doc.textContent).toBe("ab");
    expect(head(editor)).toBe(2); // on "b"
  });

  it("a selection set past the text (a click) is clamped too", () => {
    // Fails if: appendClampAndGoalReset is removed (head stays 4).
    const editor = makeVimEditor("<p>abc</p>");
    place(editor, 4);
    expect(head(editor)).toBe(3);
  });

  it("does not touch the insert caret at the line end", () => {
    // Fails if: appendClampAndGoalReset drops its `mode === "normal"`
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
    expect(mode(editor)).toBe("normal"); // the clamp's precondition holds
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
    // Fails if: unitBeforeOnLine drops `prev < head` — at a line start
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

describe("z. homes to the first non-blank", () => {
  it("lands on the line's first non-blank; zz leaves the cursor", () => {
    // Fails if: runScrollCursor ignores firstNonBlank (or inverts it), or
    // drops its selection write — the cursor stays on "e".
    const editor = makeVimEditor("<p>x</p>");
    // JSON, not HTML: the HTML parser collapses the leading blanks.
    editor.commands.setContent({
      content: [
        { content: [{ text: "   abc def", type: "text" }], type: "paragraph" },
      ],
      type: "doc",
    });
    expect(editor.state.doc.textContent).toBe("   abc def");
    place(editor, 9); // "e"
    key(editor, "z");
    key(editor, "z");
    expect(head(editor)).toBe(9);
    key(editor, "z");
    key(editor, ".");
    expect(head(editor)).toBe(4); // "a"
  });
});

describe("the clamp waits while vim is suspended", () => {
  it("an island's caret at a line end is left alone, then clamped once vim is back", () => {
    // Suspended = a NodeView island owns the keys. Fails if:
    // appendClampAndGoalReset drops its `!vim.suspended` check — the caret
    // at the line end is clamped under the island.
    const editor = makeVimEditor("<p>abc</p>");
    const atEnd = () =>
      editor.state.applyTransaction(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4)),
      ).transactions;
    editor.view.dispatch(
      editor.state.tr.setMeta(vimPluginKey, {
        suspended: true,
        type: "setSuspended",
      }),
    );
    expect(mode(editor)).toBe("normal");
    expect(atEnd()).toHaveLength(1);
    editor.view.dispatch(
      editor.state.tr.setMeta(vimPluginKey, {
        suspended: false,
        type: "setSuspended",
      }),
    );
    expect(atEnd()).toHaveLength(2); // control: the same caret IS clamped
  });
});

describe("the normal cursor on an empty hard-break segment", () => {
  /** The vim cursor decorations as [from, to] — from === to is the empty-line
   *  bar caret, from < to the painted block cursor. */
  function cursorDecorations(editor: Editor): [number, number][] {
    const plugin = vimPluginKey.get(editor.state);
    const set = plugin?.props.decorations?.call(plugin, editor.state) as
      DecorationSet | null | undefined;
    return (set?.find() ?? []).map((d) => [d.from, d.to]);
  }

  it("draws the empty-line caret, not a painted hard break", () => {
    // "ab", break, (empty), break, "cd": the empty middle segment's only
    // position sits before the second break. Fails if: isLineBreakUnit does
    // not count a hardBreak — the block cursor paints the <br> ([4, 5]),
    // which shows nothing.
    const editor = makeVimEditor("<p>ab<br><br>cd</p>");
    place(editor, 4);
    expect(head(editor)).toBe(4);
    expect(cursorDecorations(editor)).toEqual([[4, 4]]);
  });

  it("a character keeps the block cursor (control)", () => {
    const editor = makeVimEditor("<p>ab<br><br>cd</p>");
    place(editor, 6);
    expect(cursorDecorations(editor)).toEqual([[6, 7]]);
  });
});

describe("insert Esc collapses a range made while inserting", () => {
  it("a forward range starting inside a text cluster still lands on the whole unit", () => {
    // Fails if: forwardRangeEscTarget bounds onLine by sel.from: head stays 4, not 1.
    const editor = makeVimEditor("<p>한x</p>");
    place(editor, 1);
    key(editor, "i");
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, 2, 4),
      ),
    );
    key(editor, "Escape");
    expect(head(editor)).toBe(1);
    expect(editor.state.selection.empty).toBe(true);
  });

  it("a backward range whose head is inside a code block lands after the block", () => {
    // Fails if: insertEscTarget returns target without the code-block detour: head stays 7, not 12.
    const editor = makeVimEditor(
      "<p>para</p><pre><code>xyz</code></pre><p>after</p>",
    );
    place(editor, 1);
    key(editor, "i");
    const doc = editor.state.doc;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.between(doc.resolve(15), doc.resolve(6)),
      ),
    );
    const landings: string[] = [];
    const enter = cmRegistry.enterCodeBlockSelection;
    const handoff = vi
      .spyOn(cmRegistry, "enterCodeBlockSelection")
      .mockImplementation((view, ...args) => {
        landings.push(view.state.selection.$head.parent.type.name);
        return enter(view, ...args);
      });
    key(editor, "Escape");
    expect(mode(editor)).toBe("normal");
    expect(head(editor)).toBe(12);
    expect(landings).toEqual(["paragraph"]);
    expect(handoff).toHaveBeenCalledTimes(1);
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.$head.parent.type.name).toBe("paragraph");
    handoff.mockRestore();
  });

  it("a forward range whose head is at a code block's content end lands before the block", () => {
    // Fails if: insertEscTarget returns target without the code-block detour: head is 9, not 4.
    const editor = makeVimEditor(
      "<p>para</p><pre><code>xyz</code></pre><p>after</p>",
    );
    place(editor, 2);
    key(editor, "i");
    const doc = editor.state.doc;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(doc, 2, 10)),
    );
    const landings: string[] = [];
    const enter = cmRegistry.enterCodeBlockSelection;
    const handoff = vi
      .spyOn(cmRegistry, "enterCodeBlockSelection")
      .mockImplementation((view, ...args) => {
        landings.push(view.state.selection.$head.parent.type.name);
        return enter(view, ...args);
      });
    key(editor, "Escape");
    expect(mode(editor)).toBe("normal");
    expect(head(editor)).toBe(4);
    expect(landings).toEqual(["paragraph"]);
    expect(handoff).toHaveBeenCalledTimes(1);
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.$head.parent.type.name).toBe("paragraph");
    handoff.mockRestore();
  });

  it("a range up to the start of a document that opens with a code block lands after the block", () => {
    // Fails if: insertEscTarget returns target without the code-block detour: head stays 1, not 6.
    const editor = makeVimEditor("<pre><code>xyz</code></pre><p>after</p>");
    place(editor, 9);
    key(editor, "i");
    const doc = editor.state.doc;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.between(doc.resolve(9), doc.resolve(0)),
      ),
    );
    const landings: string[] = [];
    const enter = cmRegistry.enterCodeBlockSelection;
    const handoff = vi
      .spyOn(cmRegistry, "enterCodeBlockSelection")
      .mockImplementation((view, ...args) => {
        landings.push(view.state.selection.$head.parent.type.name);
        return enter(view, ...args);
      });
    key(editor, "Escape");
    expect(mode(editor)).toBe("normal");
    expect(head(editor)).toBe(6);
    expect(landings).toEqual(["paragraph"]);
    expect(handoff).toHaveBeenCalledTimes(1);
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.$head.parent.type.name).toBe("paragraph");
    handoff.mockRestore();
  });

  it("a backward range wholly inside one code block is left as it is", () => {
    // Fails if: findOutsideCodeBlocks drops found.from > range.to: the handoff predicate is called.
    const editor = makeVimEditor(
      "<p>para</p><pre><code>xyz</code></pre><p>after</p>",
    );
    place(editor, 1);
    key(editor, "i");
    const doc = editor.state.doc;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(doc, 9, 7)),
    );
    const handoff = vi.spyOn(cmRegistry, "enterCodeBlockSelection");
    key(editor, "Escape");
    expect(handoff).not.toHaveBeenCalled();
    expect(mode(editor)).toBe("normal");
    expect([
      editor.state.selection.anchor,
      editor.state.selection.head,
    ]).toEqual([9, 7]);
    handoff.mockRestore();
  });

  it("a forward range wholly inside one code block is left as it is", () => {
    // Fails if: findOutsideCodeBlocks drops found.to < range.from: the handoff predicate is called.
    const editor = makeVimEditor(
      "<p>para</p><pre><code>xyz</code></pre><p>after</p>",
    );
    place(editor, 1);
    key(editor, "i");
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, 7, 9),
      ),
    );
    const handoff = vi.spyOn(cmRegistry, "enterCodeBlockSelection");
    key(editor, "Escape");
    expect(handoff).not.toHaveBeenCalled();
    expect(mode(editor)).toBe("normal");
    expect([editor.state.selection.anchor, head(editor)]).toEqual([7, 9]);
    handoff.mockRestore();
  });

  it("a forward range from a paragraph's end into a code block lands on the paragraph's last unit", () => {
    // Fails if: findOutsideCodeBlocks bounds the returned unit start: head stays 9, not 4.
    const editor = makeVimEditor(
      "<p>para</p><pre><code>xyz</code></pre><p>after</p>",
    );
    place(editor, 1);
    key(editor, "i");
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, 5, 9),
      ),
    );
    const landings: string[] = [];
    const enter = cmRegistry.enterCodeBlockSelection;
    const handoff = vi
      .spyOn(cmRegistry, "enterCodeBlockSelection")
      .mockImplementation((view, ...args) => {
        landings.push(view.state.selection.$head.parent.type.name);
        return enter(view, ...args);
      });
    key(editor, "Escape");
    expect(head(editor)).toBe(4);
    expect(mode(editor)).toBe("normal");
    expect(editor.state.selection.empty).toBe(true);
    expect(landings).toEqual(["paragraph"]);
    handoff.mockRestore();
  });

  it("a forward range from a code block to the next paragraph's start lands at its head", () => {
    // Fails if: findOutsideCodeBlocks drops its range bounds: head is 4, not 12.
    const editor = makeVimEditor(
      "<p>para</p><pre><code>xyz</code></pre><p>after</p>",
    );
    place(editor, 1);
    key(editor, "i");
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, 8, 12),
      ),
    );
    key(editor, "Escape");
    expect(head(editor)).toBe(12);
    expect(mode(editor)).toBe("normal");
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.$head.parent.type.name).toBe("paragraph");
  });

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
    // Fails if: forwardRangeEscTarget stops at the head's own line — the head itself
    // ("c", outside the half-open range) would be the landing.
    const editor = makeVimEditor("<p>ab</p><p>cd</p>");
    selectThenEscape(editor, 1, 5); // "ab" + the break, head before "c"
    expect(head(editor)).toBe(2); // on "b"
    key(editor, "i");
    editor.view.dispatch(editor.state.tr.insertText("X"));
    expect(editor.state.doc.child(0).textContent).toBe("aXb");
  });

  it("…and an empty previous line is landed on as such", () => {
    // Fails if: forwardRangeEscTarget drops its empty-line fallback (no unit start
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
    // Fails if: forwardRangeEscTarget stops at the code block instead of searching
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

describe("insert Esc cursor dispatch", () => {
  it("a moving Esc suppresses DOM selection updates through dispatchCursor", () => {
    // Fails if: escapeInsertCursor uses view.dispatch directly: suppression is called zero times.
    const editor = makeVimEditor("<p>abcd</p>");
    place(editor, 3);
    key(editor, "i");
    const observer = (
      editor.view as unknown as {
        domObserver: { suppressSelectionUpdates: () => void };
      }
    ).domObserver;
    const suppress = vi.spyOn(observer, "suppressSelectionUpdates");
    key(editor, "Escape");
    expect(head(editor)).toBe(2);
    expect(suppress).toHaveBeenCalledTimes(1);
  });

  it("Esc steps back onto the first character typed at a line start", () => {
    // Fails if: unitBeforeOnLine uses prev > lineStart: head stays 2 instead of 1.
    const editor = makeVimEditor("<p>abc</p>");
    insertThenEscape(editor, 1, "X");
    expect(editor.state.doc.textContent).toBe("Xabc");
    expect(head(editor)).toBe(1);
  });
});
