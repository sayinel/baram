// §298 Vim Phase 1 — motions against the REAL Baram schema (S3, design P1).
//
// The vertical model: every hard-break segment and every atom block is one
// line. j/k preserve the column, clamped into the target line.

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../../../index";
import { resolveMotion } from "../motions";

const editors: Editor[] = [];

function makeEditor(content: string): Editor {
  const editor = new Editor({ content, extensions: createBaramExtensions() });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
});

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

describe("h/l — grapheme units", () => {
  it("l advances one grapheme; counts clamp at the LAST unit start", () => {
    const editor = makeEditor("<p>abc</p>");
    const a = posOfText(editor, "a");
    expect(resolveMotion(editor.state, a, "charRight", 1)).toBe(a + 1);
    // The boundary past "c" is not a cursor position (S3-R1).
    expect(resolveMotion(editor.state, a, "charRight", 3)).toBe(a + 2);
    expect(resolveMotion(editor.state, a, "charRight", 99)).toBe(a + 2);
  });

  it("h treats an NFD hangul cluster as ONE unit", () => {
    const editor = makeEditor(`<p>a${"가"}</p>`);
    const end = editor.state.doc.content.size - 1;
    expect(resolveMotion(editor.state, end, "charLeft", 1)).toBe(end - 2);
  });

  it("h/l cross an inline atom as one unit", () => {
    const editor = makeEditor("<p>x</p>");
    editor.commands.setContent({
      content: [
        {
          content: [
            { text: "a", type: "text" },
            { attrs: { target: "n" }, type: "wikilink" },
            { text: "b", type: "text" },
          ],
          type: "paragraph",
        },
      ],
      type: "doc",
    });
    const a = posOfText(editor, "a");
    expect(resolveMotion(editor.state, a + 1, "charRight", 1)).toBe(a + 2);
    expect(resolveMotion(editor.state, a + 2, "charLeft", 1)).toBe(a + 1);
  });
});

describe("0/$ — line bounds", () => {
  it("uses the SEGMENT as the line inside a<br>bcd", () => {
    const editor = makeEditor("<p>ab<br>cde</p>");
    const c = posOfText(editor, "c");
    expect(resolveMotion(editor.state, c + 1, "lineStart", 1)).toBe(c);
    expect(resolveMotion(editor.state, c + 1, "lineEnd", 1)).toBe(c + 2); // ON "e"
  });
});

describe("j/k — logical lines with column preservation", () => {
  it("j lands on the same column of the next paragraph", () => {
    const editor = makeEditor("<p>alpha</p><p>bravo</p>");
    const from = posOfText(editor, "pha"); // column 2 of alpha
    expect(resolveMotion(editor.state, from, "lineDown", 1)).toBe(
      posOfText(editor, "bravo") + 2,
    );
  });

  it("column clamps into a shorter line and k returns", () => {
    const editor = makeEditor("<p>longline</p><p>ab</p>");
    const from = posOfText(editor, "e"); // deep column
    const down = resolveMotion(editor.state, from, "lineDown", 1);
    expect(down).toBe(posOfText(editor, "a") + 1); // ON "b" — last unit start
    const up = resolveMotion(editor.state, down, "lineUp", 1);
    expect(up).toBe(posOfText(editor, "longline") + 1); // column 1, not remembered
  });

  it("segments of one paragraph are separate j-lines", () => {
    const editor = makeEditor("<p>aa<br>bb</p>");
    const a = posOfText(editor, "aa");
    expect(resolveMotion(editor.state, a, "lineDown", 1)).toBe(
      posOfText(editor, "bb"),
    );
  });

  it("an atom block is a j/k stop", () => {
    const editor = makeEditor("<p>x</p>");
    editor.commands.setContent({
      content: [
        { content: [{ text: "up", type: "text" }], type: "paragraph" },
        { attrs: { latex: "x" }, type: "mathBlock" },
        { content: [{ text: "dn", type: "text" }], type: "paragraph" },
      ],
      type: "doc",
    });
    const up = posOfText(editor, "up");
    const onAtom = resolveMotion(editor.state, up, "lineDown", 1);
    expect(editor.state.doc.nodeAt(onAtom)?.type.name).toBe("mathBlock");
    expect(resolveMotion(editor.state, onAtom, "lineDown", 1)).toBe(
      posOfText(editor, "dn"),
    );
    expect(resolveMotion(editor.state, onAtom, "lineUp", 1)).toBe(up);
  });

  it("2j skips a line; excess count clamps at the last line", () => {
    const editor = makeEditor("<p>one</p><p>two</p><p>tri</p>");
    const one = posOfText(editor, "one");
    expect(resolveMotion(editor.state, one, "lineDown", 2)).toBe(
      posOfText(editor, "tri"),
    );
    expect(resolveMotion(editor.state, one, "lineDown", 99)).toBe(
      posOfText(editor, "tri"),
    );
  });
});

describe("w/b — word starts", () => {
  it("w hops word starts and crosses to the next line", () => {
    const editor = makeEditor("<p>foo bar</p><p>baz</p>");
    const foo = posOfText(editor, "foo");
    const bar = resolveMotion(editor.state, foo, "wordForward", 1);
    expect(bar).toBe(posOfText(editor, "bar"));
    expect(resolveMotion(editor.state, bar, "wordForward", 1)).toBe(
      posOfText(editor, "baz"),
    );
    expect(resolveMotion(editor.state, foo, "wordForward", 2)).toBe(
      posOfText(editor, "baz"),
    );
  });

  it("b hops back across lines", () => {
    const editor = makeEditor("<p>foo bar</p><p>baz</p>");
    const baz = posOfText(editor, "baz");
    expect(resolveMotion(editor.state, baz, "wordBack", 1)).toBe(
      posOfText(editor, "bar"),
    );
    expect(
      resolveMotion(editor.state, posOfText(editor, "foo"), "wordBack", 1),
    ).toBe(posOfText(editor, "foo"));
  });
});

describe("gg/G", () => {
  it("gg goes to the first line, G to the LAST line start", () => {
    const editor = makeEditor("<p>one</p><p>two</p><p>tri</p>");
    const mid = posOfText(editor, "two");
    expect(resolveMotion(editor.state, mid, "docStart", 1)).toBe(
      posOfText(editor, "one"),
    );
    expect(resolveMotion(editor.state, mid, "docEnd", 1)).toBe(
      posOfText(editor, "tri"),
    );
  });
});

describe("impl review S3-R1 pins", () => {
  it("l on the last character stays; $ lands ON it (cursor = unit start)", () => {
    const editor = makeEditor("<p>abc</p>");
    const c = posOfText(editor, "c");
    expect(resolveMotion(editor.state, c, "charRight", 1)).toBe(c);
    expect(
      resolveMotion(editor.state, posOfText(editor, "a"), "lineEnd", 1),
    ).toBe(c);
  });

  it("j never lands inside an NFD grapheme cluster", () => {
    const editor = makeEditor(`<p>ab</p><p>${"\u1100\u1161"}x</p>`);
    const b = posOfText(editor, "b");
    const target = resolveMotion(editor.state, b, "lineDown", 1);
    const line2 = editor.state.doc.child(1);
    const start = editor.state.doc.content.size - line2.nodeSize + 1;
    // column 1 unit = ON "x" (after the 2-codepoint cluster), never start+1
    expect(target).toBe(start + 2);
  });

  it("j in a table moves to the NEXT ROW, not the neighbouring cell", () => {
    const editor = makeEditor(
      "<table><tr><td><p>aa</p></td><td><p>bb</p></td></tr><tr><td><p>cc</p></td><td><p>dd</p></td></tr></table>",
    );
    const a = posOfText(editor, "aa");
    const target = resolveMotion(editor.state, a, "lineDown", 1);
    expect(editor.state.doc.resolve(target).parent.textContent).toBe("cc");
  });

  it("j from the SECOND column stays in that column", () => {
    const editor = makeEditor(
      "<table><tr><td><p>aa</p></td><td><p>bb</p></td></tr><tr><td><p>cc</p></td><td><p>dd</p></td></tr></table>",
    );
    const b = posOfText(editor, "bb");
    const target = resolveMotion(editor.state, b, "lineDown", 1);
    expect(editor.state.doc.resolve(target).parent.textContent).toBe("dd");
  });

  it("counted w reuses one line scan — no O(count x doc) stall", () => {
    const paras = Array.from({ length: 3000 }, (_, i) => `<p>w${i} x</p>`).join(
      "",
    );
    const editor = makeEditor(paras);
    const startAt = posOfText(editor, "w0");
    const t0 = performance.now();
    resolveMotion(editor.state, startAt, "wordForward", 999);
    expect(performance.now() - t0).toBeLessThan(250);
  });
});

describe("impl review S3-R2 pins", () => {
  it("j from a rowspan cell lands below the SPAN, not back on itself", () => {
    const editor = makeEditor(
      '<table><tr><td rowspan="2"><p>aa</p></td><td><p>bb</p></td></tr><tr><td><p>cc</p></td></tr><tr><td><p>dd</p></td><td><p>ee</p></td></tr></table>',
    );
    const a = posOfText(editor, "aa");
    const target = resolveMotion(editor.state, a, "lineDown", 1);
    expect(editor.state.doc.resolve(target).parent.textContent).toBe("dd");
  });

  it("counted b near EOF carries the line index — no per-step rescan", () => {
    const paras = Array.from({ length: 6000 }, (_, i) => `<p>w${i} x</p>`).join(
      "",
    );
    const editor = makeEditor(paras);
    const nearEnd = posOfText(editor, "w5999");
    const t0 = performance.now();
    resolveMotion(editor.state, nearEnd, "wordBack", 999);
    expect(performance.now() - t0).toBeLessThan(300);
  });
});

describe("impl review S3-R3 pin — counted j/k across a mid rowspan", () => {
  const grid =
    "<table>" +
    "<tr><td><p>a0</p></td><td><p>b0</p></td></tr>" +
    '<tr><td rowspan="2"><p>sp</p></td><td><p>b1</p></td></tr>' +
    "<tr><td><p>b2</p></td></tr>" +
    "<tr><td><p>a3</p></td><td><p>b3</p></td></tr>" +
    "</table>";

  it("2j equals j;j through the span", () => {
    const editor = makeEditor(grid);
    const a0 = posOfText(editor, "a0");
    const once = resolveMotion(editor.state, a0, "lineDown", 1);
    const twice = resolveMotion(editor.state, once, "lineDown", 1);
    expect(editor.state.doc.resolve(twice).parent.textContent).toBe("a3");
    expect(resolveMotion(editor.state, a0, "lineDown", 2)).toBe(twice);
  });

  it("2k equals k;k through the span", () => {
    const editor = makeEditor(grid);
    const a3 = posOfText(editor, "a3");
    const once = resolveMotion(editor.state, a3, "lineUp", 1);
    const twice = resolveMotion(editor.state, once, "lineUp", 1);
    expect(editor.state.doc.resolve(twice).parent.textContent).toBe("a0");
    expect(resolveMotion(editor.state, a3, "lineUp", 2)).toBe(twice);
  });
});
