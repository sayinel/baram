import { Schema } from "@tiptap/pm/model";
// Roundtrip tests — Highlight, Subscript, Superscript inline marks
import { describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../md-to-pm";
import { prosemirrorToMarkdown } from "../pm-to-md";

// Build a schema matching our extensions (includes new marks)
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", marks: "_" },
    heading: {
      content: "inline*",
      group: "block",
      attrs: { level: { default: 1 } },
    },
    hardBreak: { inline: true, group: "inline" },
    text: { group: "inline" },
  },
  marks: {
    bold: {},
    italic: {},
    code: { excludes: "_" },
    strike: {},
    highlight: {},
    subscript: {},
    superscript: {},
    link: {
      attrs: {
        href: { default: null },
        title: { default: null },
      },
      inclusive: false,
    },
  },
});

function roundtrip(input: string): string {
  const doc = markdownToProsemirror(input, schema);
  return prosemirrorToMarkdown(doc);
}

describe("Roundtrip: Highlight ==text==", () => {
  it.each([
    ["basic highlight", "This is ==highlighted== text\n"],
    ["highlight at start", "==highlighted== text\n"],
    ["highlight at end", "text ==highlighted==\n"],
    ["highlight only", "==highlighted==\n"],
    ["highlight with spaces inside", "==two words==\n"],
  ])("%s", (_, input) => {
    expect(roundtrip(input)).toBe(input);
  });

  it("should not match single =", () => {
    const input = "a = b\n";
    expect(roundtrip(input)).toBe(input);
  });
});

describe("Roundtrip: Subscript ~text~", () => {
  it.each([
    ["basic subscript", "H~2~O is water\n"],
    ["subscript at start", "~sub~script\n"],
    ["subscript at end", "text ~sub~\n"],
    ["subscript only", "~sub~\n"],
  ])("%s", (_, input) => {
    expect(roundtrip(input)).toBe(input);
  });

  it("should not match ~~ (strikethrough)", () => {
    const input = "~~strikethrough~~\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("isolated ~ is escaped by remark-gfm", () => {
    // remark-gfm escapes standalone ~ to prevent strikethrough interpretation
    expect(roundtrip("a ~ b\n")).toBe("a \\~ b\n");
  });
});

describe("Roundtrip: Superscript ^text^", () => {
  it.each([
    ["basic superscript", "E = mc^2^\n"],
    ["superscript at start", "^super^script\n"],
    ["superscript at end", "text ^super^\n"],
    ["superscript only", "^super^\n"],
  ])("%s", (_, input) => {
    expect(roundtrip(input)).toBe(input);
  });

  it("should not match isolated ^", () => {
    const input = "a ^ b\n";
    expect(roundtrip(input)).toBe(input);
  });
});

describe("Roundtrip: Nested & combined marks", () => {
  // Custom marks (highlight, sub, sup) wrap outside standard marks in mdast, and
  // are written as `<mark>` / `<sub>` / `<sup>` when they hold anything but plain
  // text — see wrapCustomInlineMark in pm-to-md.ts.
  //
  // These two used to assert the shorthand output (`==**bold highlight**==`,
  // `~*italic sub*~`). That output is NOT a fixed point: reading it back splits
  // into text/strong/text, the shorthand regex — which only ever matches inside a
  // single text node — finds no pair, the custom mark is lost, and the next save
  // writes `\==**bold highlight**==`. The tests were named for a round trip while
  // pinning a form that could not survive one, so opening a file and saving it
  // changed its bytes. Each case now asserts the fixed point explicitly, which is
  // what makes the difference visible.
  it("bold + highlight (custom mark wraps outer)", () => {
    const output = roundtrip("**==bold highlight==**\n");
    expect(output).toBe("<mark>**bold highlight**</mark>\n");
    expect(roundtrip(output)).toBe(output);
  });

  it("italic + subscript (custom mark wraps outer)", () => {
    const output = roundtrip("*~italic sub~*\n");
    expect(output).toBe("<sub>*italic sub*</sub>\n");
    expect(roundtrip(output)).toBe(output);
  });

  it("multiple custom marks in one line", () => {
    expect(roundtrip("==highlight== with ^super^ and ~sub~\n")).toBe(
      "==highlight== with ^super^ and ~sub~\n",
    );
  });

  it("highlight in heading", () => {
    expect(roundtrip("## ==highlighted== heading\n")).toBe(
      "## ==highlighted== heading\n",
    );
  });
});

describe("Roundtrip: inline code inside other marks (data-loss regression)", () => {
  // Inline code is a leaf in mdast (no children), so it must be the innermost
  // node of any surrounding mark — but the surrounding mark itself must not
  // be dropped, and adjacent same-mark runs split by the code leaf must
  // still serialize as ONE continuous span.
  it.each([
    ["code at start of a strong span", "**`code` more text**\n"],
    ["code in the middle of a strong span", "**text `code` more**\n"],
    ["code at end of a strong span", "**text `code`**\n"],
    ["code inside an emphasis span", "*`code` in italic*\n"],
    ["code as the entire link text", "[`code`](https://example.com)\n"],
    [
      "code surrounded by other text inside a link",
      "[before `code` after](https://example.com)\n",
    ],
  ])("%s", (_, input) => {
    expect(roundtrip(input)).toBe(input);
  });

  // Control case: no code mark at all. Guards against a regression that
  // stops applying marks entirely (which the cases above alone could not
  // distinguish from "marks silently dropped everywhere").
  it("bold and italic with no code mark (control)", () => {
    expect(roundtrip("**bold** and *italic*\n")).toBe(
      "**bold** and *italic*\n",
    );
  });
});
