// §298 Vim Phase 1 — S4 operations against the REAL Baram schema (design §9).
//
// Builders return transactions; tests apply them purely and inspect the
// resulting document. Every named §9 pin lands here: container escalation,
// nested-list lift, table row guards, segment deletes, grapheme x, the
// inclusive visual range, and the paste matrix (incl. the demotion rows).

import type { VimRegister } from "../register";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../../../index";
import {
  deleteCharForward,
  deleteLine,
  deleteVisual,
  yankLine,
  yankVisual,
} from "../operations";
import { pasteRegister } from "../paste";
import {
  readVimRegister,
  resetVimRegister,
  writeVimRegister,
} from "../register";

const editors: Editor[] = [];

function makeEditor(content: string): Editor {
  const editor = new Editor({ content, extensions: createBaramExtensions() });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
});

function applied(editor: Editor, tr: null | Transaction): PMNode {
  if (!tr) throw new Error("expected a transaction");
  return editor.state.apply(tr).doc;
}

function posOf(editor: Editor, typeName: string, index = 0): number {
  let found: null | number = null;
  let seen = 0;
  editor.state.doc.descendants((node, pos) => {
    if (found === null && node.type.name === typeName) {
      if (seen === index) found = pos;
      seen++;
    }
    return found === null;
  });
  if (found === null) throw new Error(`not found: ${typeName}[${index}]`);
  return found;
}

/** Position of the first character of `text` inside the document. */
function posOfText(editor: Editor, text: string): number {
  let found: null | number = null;
  editor.state.doc.descendants((node, pos) => {
    if (found === null && node.isText && node.text?.includes(text)) {
      found = pos + (node.text?.indexOf(text) ?? 0);
    }
    return found === null;
  });
  if (found === null) throw new Error(`text not found: ${text}`);
  return found;
}

describe("deleteLine — dd (§9)", () => {
  it("deletes a plain paragraph and yanks it as line/top", () => {
    const editor = makeEditor("<p>one</p><p>two</p><p>three</p>");
    const out = deleteLine(editor.state, posOfText(editor, "two"), 1);
    const doc = applied(editor, out.tr);
    expect(doc.textContent).toBe("onethree");
    expect(out.register).toMatchObject({ context: "top", kind: "line" });
    expect((out.register as { content: unknown[] }).content).toHaveLength(1);
  });

  it("2dd removes two units in ONE transaction", () => {
    const editor = makeEditor("<p>one</p><p>two</p><p>three</p>");
    const out = deleteLine(editor.state, posOfText(editor, "one"), 2);
    const doc = applied(editor, out.tr);
    expect(doc.textContent).toBe("three");
    expect((out.register as { content: unknown[] }).content).toHaveLength(2);
  });

  it("deletes the CONTAINER when its only child goes (§9)", () => {
    const editor = makeEditor("<blockquote><p>only</p></blockquote><p>x</p>");
    const out = deleteLine(editor.state, posOfText(editor, "only"), 1);
    const doc = applied(editor, out.tr);
    expect(doc.firstChild?.type.name).toBe("paragraph");
    expect(doc.textContent).toBe("x");
  });

  it("keeps a container that still has siblings", () => {
    const editor = makeEditor("<blockquote><p>one</p><p>two</p></blockquote>");
    const out = deleteLine(editor.state, posOfText(editor, "one"), 1);
    const doc = applied(editor, out.tr);
    expect(doc.firstChild?.type.name).toBe("blockquote");
    expect(doc.textContent).toBe("two");
  });

  it("deletes only the middle segment of a⏎b⏎c", () => {
    const editor = makeEditor("<p>a<br>b<br>c</p>");
    const out = deleteLine(editor.state, posOfText(editor, "b"), 1);
    const doc = applied(editor, out.tr);
    expect(doc.firstChild?.childCount).toBe(3); // a, ⏎, c
    expect(doc.textContent).toBe("ac");
  });

  it("lifts nested items into the parent list (spike #7 pin)", () => {
    const editor = makeEditor(
      "<ul><li><p>parent</p><ul><li><p>child</p></li></ul></li><li><p>sib</p></li></ul>",
    );
    const out = deleteLine(editor.state, posOfText(editor, "parent"), 1);
    const doc = applied(editor, out.tr);
    const list = doc.firstChild!;
    expect(list.childCount).toBe(2);
    expect(list.child(0).textContent).toBe("child");
    expect(list.child(1).textContent).toBe("sib");
  });

  it("a sole item with children hands the list over to them", () => {
    const editor = makeEditor(
      "<ul><li><p>parent</p><ul><li><p>child</p></li></ul></li></ul><p>x</p>",
    );
    const out = deleteLine(editor.state, posOfText(editor, "parent"), 1);
    const doc = applied(editor, out.tr);
    expect(doc.firstChild?.type.name).toBe("bulletList");
    expect(doc.firstChild?.textContent).toBe("child");
  });

  it("a sole childless item takes its list with it", () => {
    const editor = makeEditor("<ul><li><p>only</p></li></ul><p>x</p>");
    const out = deleteLine(editor.state, posOfText(editor, "only"), 1);
    const doc = applied(editor, out.tr);
    expect(doc.childCount).toBe(1);
    expect(doc.textContent).toBe("x");
  });

  it("dd on the only line leaves one empty paragraph, not an empty doc", () => {
    const editor = makeEditor("<p>alone</p>");
    const out = deleteLine(editor.state, posOfText(editor, "alone"), 1);
    const doc = applied(editor, out.tr);
    expect(doc.childCount).toBe(1);
    expect(doc.textContent).toBe("");
  });

  it("deletes a data row via row normalization, header intact", () => {
    const editor = makeEditor(
      "<table><tr><th><p>h</p></th></tr><tr><td><p>a</p></td></tr><tr><td><p>b</p></td></tr></table>",
    );
    const out = deleteLine(editor.state, posOfText(editor, "a"), 1);
    const doc = applied(editor, out.tr);
    expect(doc.firstChild?.childCount).toBe(2); // header + one data row
    expect(doc.textContent).toContain("h");
    expect(doc.textContent).not.toContain("a");
    expect(out.register).toMatchObject({ context: "tableRow", kind: "line" });
  });

  it("refuses the header row and the only data row (v2 pins)", () => {
    const editor = makeEditor(
      "<table><tr><th><p>h</p></th></tr><tr><td><p>a</p></td></tr></table>",
    );
    const header = deleteLine(editor.state, posOfText(editor, "h"), 1);
    expect(header.tr).toBeNull();
    expect(header.reason).toMatch(/header/);

    const only = deleteLine(editor.state, posOfText(editor, "a"), 1);
    expect(only.tr).toBeNull();
    expect(only.reason).toMatch(/only table row/);
  });
});

describe("yankLine — yy (§9)", () => {
  it("yy on a segment yanks a demoted top-context paragraph", () => {
    const editor = makeEditor("<p>a<br>b</p>");
    const out = yankLine(editor.state, posOfText(editor, "b"), 1);
    expect(out.tr).toBeNull();
    expect(out.reason).toBeUndefined();
    const reg = out.register as Extract<VimRegister, { kind: "line" }>;
    expect(reg.context).toBe("top");
    expect(editor.state.schema.nodeFromJSON(reg.content[0]).textContent).toBe(
      "b",
    );
  });

  it("2yy walks forward without mutating and clamps at EOF", () => {
    const editor = makeEditor("<p>one</p><p>two</p>");
    const out = yankLine(editor.state, posOfText(editor, "one"), 5);
    const reg = out.register as Extract<VimRegister, { kind: "line" }>;
    expect(reg.content).toHaveLength(2);
    expect(editor.state.doc.textContent).toBe("onetwo"); // untouched
  });
});

describe("deleteCharForward — x (§6 units)", () => {
  it("deletes one full grapheme of 조합 한글 (NFD jamo sequence)", () => {
    // \u1100\u1161 is 가 DECOMPOSED (ᄀ+ᅡ), spelled as escapes so no tool
    // can silently NFC-normalize it. A precomposed 가 would pass even under
    // broken code-unit deletion, making this pin vacuous.
    const editor = makeEditor(`<p>${"\u1100\u1161"}나</p>`);
    const from = posOf(editor, "paragraph") + 1;
    const out = deleteCharForward(editor.state, from, 1);
    expect(applied(editor, out.tr).textContent).toBe("나");
  });
  it("deletes an emoji with modifiers as ONE unit", () => {
    const editor = makeEditor("<p>👍🏽a</p>");
    const out = deleteCharForward(editor.state, posOfText(editor, "👍🏽"), 1);
    expect(applied(editor, out.tr).textContent).toBe("a");
  });

  it("treats an inline atom as one unit", () => {
    const editor = makeEditor("<p>x</p>");
    editor.commands.setContent({
      content: [
        {
          content: [
            { attrs: { target: "note" }, type: "wikilink" },
            { text: "tail", type: "text" },
          ],
          type: "paragraph",
        },
      ],
      type: "doc",
    });
    const para = posOf(editor, "paragraph");
    const out = deleteCharForward(editor.state, para + 1, 1);
    const doc = applied(editor, out.tr);
    expect(doc.textContent).toBe("tail");
    expect(doc.firstChild?.childCount).toBe(1);
  });

  it("3x eats three units and fills a char register that pastes back", () => {
    const editor = makeEditor("<p>abcd</p>");
    const from = posOfText(editor, "a");
    const out = deleteCharForward(editor.state, from, 3);
    const cut = editor.state.apply(out.tr!);
    expect(cut.doc.textContent).toBe("d");

    const back = pasteRegister(cut, from, out.register!, false, 1);
    expect(cut.apply(back.tr!).doc.textContent).toBe("abcd");
  });
});

describe("visual d/y (§6 inclusive)", () => {
  it("the unit under the head is INCLUDED", () => {
    const editor = makeEditor("<p>abcdef</p>");
    const visual = {
      anchorCursor: posOfText(editor, "b"),
      headCursor: posOfText(editor, "d"),
    };
    const out = deleteVisual(editor.state, visual);
    expect(applied(editor, out.tr).textContent).toBe("aef");
  });

  it("a reversed selection yields the same range", () => {
    const editor = makeEditor("<p>abcdef</p>");
    const visual = {
      anchorCursor: posOfText(editor, "d"),
      headCursor: posOfText(editor, "b"),
    };
    const out = yankVisual(editor.state, visual);
    const paste = pasteRegister(
      editor.state,
      posOfText(editor, "f") + 1,
      out.register!,
      false,
      1,
    );
    expect(applied(editor, paste.tr).textContent).toBe("abcdefbcd");
  });

  it("marks survive the register round trip", () => {
    const editor = makeEditor("<p>a<strong>bc</strong>d</p>");
    const visual = {
      anchorCursor: posOfText(editor, "b"),
      headCursor: posOfText(editor, "c"),
    };
    const out = yankVisual(editor.state, visual);
    const target = makeEditor("<p>xy</p>");
    const paste = pasteRegister(
      target.state,
      posOfText(target, "y"),
      out.register!,
      false,
      1,
    );
    const doc = applied(target, paste.tr);
    expect(doc.textContent).toBe("xbcy");
    let bold = 0;
    doc.descendants((node) => {
      if (node.isText && node.marks.some((m) => m.type.name === "bold")) {
        bold += node.text?.length ?? 0;
      }
    });
    expect(bold).toBe(2);
  });
});

describe("paste matrix (§9)", () => {
  function lineRegisterFrom(html: string, text: string): VimRegister {
    const source = makeEditor(html);
    const out = yankLine(source.state, posOfText(source, text), 1);
    return out.register!;
  }

  it("line/top pastes as a sibling block after (p) and before (P)", () => {
    const reg = lineRegisterFrom("<p>yanked</p>", "yanked");
    const editor = makeEditor("<p>one</p><p>two</p>");
    const at = posOfText(editor, "one");

    const after = pasteRegister(editor.state, at, reg, true, 1);
    expect(applied(editor, after.tr).textContent).toBe("oneyankedtwo");

    const before = pasteRegister(editor.state, at, reg, false, 1);
    expect(applied(editor, before.tr).textContent).toBe("yankedonetwo");
  });

  it("inline-only line content becomes a new SEGMENT inside a⏎b (§9)", () => {
    const reg = lineRegisterFrom("<p>mid</p>", "mid");
    const editor = makeEditor("<p>a<br>b</p>");
    const out = pasteRegister(
      editor.state,
      posOfText(editor, "a"),
      reg,
      true,
      1,
    );
    const doc = applied(editor, out.tr);
    expect(doc.childCount).toBe(1); // still ONE paragraph
    expect(doc.textContent).toBe("amidb");
  });

  it("a list item demotes to its blocks outside a list (호환표 nested)", () => {
    const reg = lineRegisterFrom("<ul><li><p>item</p></li></ul>", "item");
    const editor = makeEditor("<p>solo</p>");
    const out = pasteRegister(
      editor.state,
      posOfText(editor, "solo"),
      reg,
      true,
      1,
    );
    const doc = applied(editor, out.tr);
    expect(doc.child(1).type.name).toBe("paragraph");
    expect(doc.child(1).textContent).toBe("item");
  });

  it("a plain line wraps into an item when pasted inside a list", () => {
    const reg = lineRegisterFrom("<p>newbie</p>", "newbie");
    const editor = makeEditor("<ul><li><p>a</p></li><li><p>b</p></li></ul>");
    const out = pasteRegister(
      editor.state,
      posOfText(editor, "a"),
      reg,
      true,
      1,
    );
    const doc = applied(editor, out.tr);
    expect(doc.firstChild?.childCount).toBe(3);
    expect(doc.firstChild?.child(1).type.name).toBe("listItem");
    expect(doc.firstChild?.child(1).textContent).toBe("newbie");
  });

  it("a yanked row pastes into a matching table; width mismatch refuses", () => {
    const editor = makeEditor(
      "<table><tr><th><p>h</p></th></tr><tr><td><p>a</p></td></tr><tr><td><p>b</p></td></tr></table>",
    );
    const yank = yankLine(editor.state, posOfText(editor, "a"), 1);
    const out = pasteRegister(
      editor.state,
      posOfText(editor, "b"),
      yank.register!,
      true,
      1,
    );
    const doc = applied(editor, out.tr);
    expect(doc.firstChild?.childCount).toBe(4);

    const wide = makeEditor(
      "<table><tr><td><p>x</p></td><td><p>y</p></td></tr><tr><td><p>z</p></td><td><p>w</p></td></tr></table>",
    );
    const refused = pasteRegister(
      wide.state,
      posOfText(wide, "x"),
      yank.register!,
      true,
      1,
    );
    expect(refused.tr).toBeNull();
    expect(refused.reason).toMatch(/width/);
  });

  it("a row register refuses to paste outside a table, and vice versa", () => {
    const table = makeEditor(
      "<table><tr><td><p>a</p></td></tr><tr><td><p>b</p></td></tr></table>",
    );
    const rowReg = yankLine(table.state, posOfText(table, "a"), 1).register!;
    const prose = makeEditor("<p>solo</p>");
    expect(
      pasteRegister(prose.state, posOfText(prose, "solo"), rowReg, true, 1).tr,
    ).toBeNull();

    const lineReg = lineRegisterFrom("<p>line</p>", "line");
    expect(
      pasteRegister(table.state, posOfText(table, "a"), lineReg, true, 1).tr,
    ).toBeNull();
  });

  it("an empty register refuses with a message", () => {
    const editor = makeEditor("<p>solo</p>");
    const out = pasteRegister(
      editor.state,
      posOfText(editor, "solo"),
      null,
      true,
      1,
    );
    expect(out.tr).toBeNull();
    expect(out.reason).toMatch(/empty/);
  });
});

describe("register store (§6 — one global register, vim semantics)", () => {
  it("holds one register across editors: yank here, paste there", () => {
    resetVimRegister();
    expect(readVimRegister()).toBeNull();

    const source = makeEditor("<p>carried</p>");
    writeVimRegister(
      yankLine(source.state, posOfText(source, "carried"), 1).register!,
    );

    const target = makeEditor("<p>base</p>");
    const out = pasteRegister(
      target.state,
      posOfText(target, "base"),
      readVimRegister(),
      true,
      1,
    );
    expect(applied(target, out.tr).textContent).toBe("basecarried");

    resetVimRegister();
    expect(readVimRegister()).toBeNull();
  });
});
