// Roundtrip tests — Highlight, Subscript, Superscript inline marks
import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
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
  it("bold + highlight (custom mark wraps outer)", () => {
    // Custom marks (highlight) wrap outside standard marks (bold) in mdast
    expect(roundtrip("**==bold highlight==**\n")).toBe(
      "==**bold highlight**==\n",
    );
  });

  it("italic + subscript (custom mark wraps outer)", () => {
    expect(roundtrip("*~italic sub~*\n")).toBe("~*italic sub*~\n");
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
