// §298 Vim Phase 1 — motions against the REAL Baram schema (S3, design P1).
//
// The vertical model: every hard-break segment and every atom block is one
// line. j/k preserve the column, clamped into the target line.

import { Editor, Node } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../../../index";
import { resolveFindChar, resolveMotion } from "../motions";

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

  it(
    "counted w cost scales with COUNT, not count x doc",
    { timeout: 60_000 },
    () => {
      const paras = Array.from(
        { length: 1200 },
        (_, i) => `<p>w${i} x</p>`,
      ).join("");
      const editor = makeEditor(paras);
      const startAt = posOfText(editor, "w0");
      // Ratio pin (host-contention immune): the O(count x doc) rescan made
      // 999w ~100x the cost of 9w; the carried index keeps them same-order.
      const t0 = performance.now();
      resolveMotion(editor.state, startAt, "wordForward", 9);
      const small = Math.max(performance.now() - t0, 1);
      const t1 = performance.now();
      resolveMotion(editor.state, startAt, "wordForward", 999);
      const large = performance.now() - t1;
      expect(large).toBeLessThan(small * 40 + 100);
    },
  );
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

  it(
    "counted b near EOF scales with COUNT, not count x doc",
    { timeout: 60_000 },
    () => {
      const paras = Array.from(
        { length: 1200 },
        (_, i) => `<p>w${i} x</p>`,
      ).join("");
      const editor = makeEditor(paras);
      const nearEnd = posOfText(editor, "w1199");
      const t0 = performance.now();
      resolveMotion(editor.state, nearEnd, "wordBack", 9);
      const small = Math.max(performance.now() - t0, 1);
      const t1 = performance.now();
      resolveMotion(editor.state, nearEnd, "wordBack", 999);
      const large = performance.now() - t1;
      expect(large).toBeLessThan(small * 40 + 100);
    },
  );
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

describe("impl review S3-R4 pins", () => {
  function repeated(
    editor: Editor,
    pos: number,
    motion: "lineDown" | "lineUp",
    n: number,
  ): number {
    let p = pos;
    for (let i = 0; i < n; i++) p = resolveMotion(editor.state, p, motion, 1);
    return p;
  }

  it("counted j equals repeated j through an intermediate CLAMP", () => {
    const editor = makeEditor("<p>abcdef</p><p>x</p><p>uvwxyz</p>");
    const deep = posOfText(editor, "f"); // column 5
    expect(resolveMotion(editor.state, deep, "lineDown", 2)).toBe(
      repeated(editor, deep, "lineDown", 2),
    );
  });

  it("counted j/k equal repeated steps through the rowspan grid", () => {
    const editor = makeEditor(
      "<p>abcdef</p>" +
        "<table>" +
        "<tr><td><p>a0</p></td><td><p>b0</p></td></tr>" +
        '<tr><td rowspan="2"><p>sp</p></td><td><p>b1</p></td></tr>' +
        "<tr><td><p>b2</p></td></tr>" +
        "<tr><td><p>a3</p></td><td><p>b3</p></td></tr>" +
        "</table>" +
        "<p>tail</p>",
    );
    const deep = posOfText(editor, "f");
    for (const n of [2, 3, 4, 5]) {
      expect(resolveMotion(editor.state, deep, "lineDown", n)).toBe(
        repeated(editor, deep, "lineDown", n),
      );
    }
    const tail = posOfText(editor, "tail") + 3;
    for (const n of [2, 3, 4, 5]) {
      expect(resolveMotion(editor.state, tail, "lineUp", n)).toBe(
        repeated(editor, tail, "lineUp", n),
      );
    }
  });

  it(
    "deep counted j scales with COUNT, not count x doc",
    { timeout: 60_000 },
    () => {
      const paras = Array.from({ length: 1200 }, (_, i) => `<p>p${i}</p>`).join(
        "",
      );
      const editor = makeEditor(paras);
      const top = posOfText(editor, "p0");
      const t0 = performance.now();
      resolveMotion(editor.state, top, "lineDown", 99);
      const small = Math.max(performance.now() - t0, 1);
      const t1 = performance.now();
      const target = resolveMotion(editor.state, top, "lineDown", 1199);
      const large = performance.now() - t1;
      // Quadratic index-rescan made large ~12x-of-linear worse; carried
      // index keeps the two same-order (ratio pin, contention immune).
      expect(large).toBeLessThan(small * 40 + 100);
      expect(editor.state.doc.resolve(target).parent.textContent).toBe("p1199");
    },
  );
});

describe("impl review S3-R5 pin — non-zero column vertical cost", () => {
  it(
    "3999j from column 99 costs the same ORDER as from column 0",
    { timeout: 60_000 },
    () => {
      const row = "x".repeat(120);
      const paras = Array.from({ length: 4000 }, () => `<p>${row}</p>`).join(
        "",
      );
      const editor = makeEditor(paras);
      const first = editor.state.doc.resolve(1);

      // RATIO pin, immune to host contention (wall-clock budgets flaked at
      // 82MB free RAM): the quadratic regression made the column-99 walk
      // ~200x the column-0 walk; the line-local index keeps them within a
      // small constant factor.
      const t0 = performance.now();
      resolveMotion(editor.state, first.start(), "lineDown", 3999);
      const columnZero = Math.max(performance.now() - t0, 1);

      const t1 = performance.now();
      const target = resolveMotion(
        editor.state,
        first.start() + 99,
        "lineDown",
        3999,
      );
      const columnNinetyNine = performance.now() - t1;

      expect(columnNinetyNine).toBeLessThan(columnZero * 25 + 100);
      // Same column at the destination — carry must not drift.
      expect(editor.state.doc.resolve(target).parentOffset).toBe(99);
    },
  );
});

describe("impl review S3-R6 pins — column semantics of the unit index", () => {
  it("j from the EOL boundary keeps the FULL column (insert-Esc path)", () => {
    const editor = makeEditor("<p>ab</p><p>cde</p>");
    const $first = editor.state.doc.resolve(1);
    const eol = $first.start() + 2; // boundary past "b" — head after insert-Esc
    const target = resolveMotion(editor.state, eol, "lineDown", 1);
    expect(editor.state.doc.resolve(target).parentOffset).toBe(2); // ON "e"
  });

  it("a marked combining char stays its own unit across the line index", () => {
    const editor = makeEditor("<p>seed</p>");
    editor.commands.setContent({
      content: [
        {
          content: [
            { text: "a", type: "text" },
            { marks: [{ type: "bold" }], text: "\u0301", type: "text" },
            { text: "x", type: "text" },
          ],
          type: "paragraph",
        },
        { content: [{ text: "abc", type: "text" }], type: "paragraph" },
      ],
      type: "doc",
    });
    // node-local units: [a][\u0301][x] — "x" sits at column 2.
    const $first = editor.state.doc.resolve(1);
    const xPos = $first.start() + 2;
    const target = resolveMotion(editor.state, xPos, "lineDown", 1);
    expect(editor.state.doc.resolve(target).parentOffset).toBe(2); // ON "c"
  });
});

describe("impl review S3-R7 pin — inline NON-LEAF atoms are one unit", () => {
  // A legal plugin-style node: inline atom WITH text content. h/l/x treat
  // it as one unit (nextUnitBoundary skips any non-text inline child), so
  // the vertical index must too — descending into it created j landings
  // that h/l could not leave.
  const InlineBox = Node.create({
    atom: true,
    content: "text*",
    group: "inline",
    inline: true,
    name: "inlineBox",
    parseHTML: () => [{ tag: "span[data-inline-box]" }],
    renderHTML: () => ["span", { "data-inline-box": "" }, 0],
  });

  it("k lands ON the atom, and h/l can leave it", () => {
    const editor = new Editor({
      content: "<p>seed</p>",
      extensions: [...createBaramExtensions(), InlineBox],
    });
    editors.push(editor);
    editor.commands.setContent({
      content: [
        {
          content: [
            { text: "ab", type: "text" },
            { content: [{ text: "XYZ", type: "text" }], type: "inlineBox" },
            { text: "cd", type: "text" },
          ],
          type: "paragraph",
        },
        { content: [{ text: "abcdef", type: "text" }], type: "paragraph" },
      ],
      type: "doc",
    });
    const $second = editor.state.doc.resolve(editor.state.doc.content.size - 2);
    const from = $second.start() + 2; // column 2 of "abcdef"
    const target = resolveMotion(editor.state, from, "lineUp", 1);
    expect(editor.state.doc.nodeAt(target)?.type.name).toBe("inlineBox");
    expect(resolveMotion(editor.state, target, "charRight", 1)).not.toBe(
      target,
    );
    expect(resolveMotion(editor.state, target, "charLeft", 1)).not.toBe(target);
  });
});

describe("^ — first non-blank (device report)", () => {
  it("skips indentation; 0 does not", () => {
    const editor = makeEditor("<p>seed</p>");
    // JSON content — HTML parsing collapses leading whitespace.
    editor.commands.setContent({
      content: [
        { content: [{ text: "   abc", type: "text" }], type: "paragraph" },
      ],
      type: "doc",
    });
    const $p = editor.state.doc.resolve(1);
    const from = $p.start() + 5; // on "b"
    expect(resolveMotion(editor.state, from, "lineFirstNonBlank", 1)).toBe(
      $p.start() + 3, // ON "a"
    );
    expect(resolveMotion(editor.state, from, "lineStart", 1)).toBe($p.start());
  });

  it("an all-blank line falls back to the line start", () => {
    const editor = makeEditor("<p>seed</p>");
    editor.commands.setContent({
      content: [
        { content: [{ text: "   ", type: "text" }], type: "paragraph" },
        { content: [{ text: "x", type: "text" }], type: "paragraph" },
      ],
      type: "doc",
    });
    const $p = editor.state.doc.resolve(1);
    expect(
      resolveMotion(editor.state, $p.start() + 2, "lineFirstNonBlank", 1),
    ).toBe($p.start());
  });

  it("works per SEGMENT inside a<br>  b", () => {
    const editor = makeEditor("<p>a<br>  bc</p>");
    const b = posOfText(editor, "bc");
    expect(resolveMotion(editor.state, b + 1, "lineFirstNonBlank", 1)).toBe(b);
  });
});

describe("f/t — find char in the line", () => {
  it("fx lands ON the char; 2fx takes the second; tx stops BEFORE", () => {
    const editor = makeEditor("<p>axbxc</p>");
    const a = posOfText(editor, "a");
    expect(resolveFindChar(editor.state, a, "x", "f", 1)).toBe(a + 1);
    expect(resolveFindChar(editor.state, a, "x", "f", 2)).toBe(a + 3);
    expect(resolveFindChar(editor.state, a, "x", "t", 2)).toBe(a + 2);
  });

  it("F/T search backward; a miss stays put", () => {
    const editor = makeEditor("<p>axbxc</p>");
    const c = posOfText(editor, "c");
    expect(resolveFindChar(editor.state, c, "x", "F", 1)).toBe(c - 1);
    expect(resolveFindChar(editor.state, c, "x", "T", 1)).toBe(c);
    expect(resolveFindChar(editor.state, c, "z", "F", 1)).toBe(c);
    expect(
      resolveFindChar(editor.state, posOfText(editor, "a"), "z", "f", 1),
    ).toBe(posOfText(editor, "a"));
  });

  it("search is SEGMENT-local — never crosses a hard break", () => {
    const editor = makeEditor("<p>ab<br>xc</p>");
    const a = posOfText(editor, "ab");
    expect(resolveFindChar(editor.state, a, "x", "f", 1)).toBe(a);
  });

  it("a hangul target matches its grapheme unit", () => {
    const editor = makeEditor("<p>seed</p>");
    editor.commands.setContent({
      content: [
        { content: [{ text: "a가b", type: "text" }], type: "paragraph" },
      ],
      type: "doc",
    });
    const start = editor.state.doc.resolve(1).start();
    expect(resolveFindChar(editor.state, start, "가", "f", 1)).toBe(start + 1);
  });
});
