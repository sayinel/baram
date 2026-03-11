import { Schema } from "@tiptap/pm/model";
// Dedicated roundtrip tests for all 9 mark extensions
// bold, italic, code, strike, link, underline, highlight, subscript, superscript
import { describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", marks: "_" },
    heading: {
      content: "inline*",
      group: "block",
      attrs: { level: { default: 1 } },
    },
    blockquote: { content: "block+", group: "block" },
    bulletList: { content: "listItem+", group: "block" },
    orderedList: {
      content: "listItem+",
      group: "block",
      attrs: { start: { default: 1 } },
    },
    listItem: { content: "paragraph block*" },
    horizontalRule: { group: "block" },
    codeBlock: {
      content: "text*",
      group: "block",
      marks: "",
      code: true,
      attrs: { language: { default: null } },
    },
    hardBreak: { inline: true, group: "inline" },
    text: { group: "inline" },
  },
  marks: {
    bold: {},
    italic: {},
    code: { excludes: "_" },
    strike: {},
    link: {
      attrs: {
        href: { default: null },
        title: { default: null },
      },
      inclusive: false,
    },
    underline: {},
    highlight: {},
    subscript: {},
    superscript: {},
  },
});

function roundtrip(input: string): string {
  const doc = markdownToProsemirror(input, schema);
  return prosemirrorToMarkdown(doc);
}

// --- Bold ---
describe("Roundtrip: Bold **text**", () => {
  it.each([
    ["basic bold", "**bold**\n"],
    ["bold in sentence", "text **bold** more\n"],
    ["bold at start", "**bold** text\n"],
    ["bold at end", "text **bold**\n"],
    ["bold multi word", "**multi word bold**\n"],
    ["bold with punctuation", "**bold!** text\n"],
  ])("%s", (_, input) => {
    expect(roundtrip(input)).toBe(input);
  });
});

// --- Italic ---
describe("Roundtrip: Italic *text*", () => {
  it.each([
    ["basic italic", "*italic*\n"],
    ["italic in sentence", "text *italic* more\n"],
    ["italic at start", "*italic* text\n"],
    ["italic at end", "text *italic*\n"],
    ["italic multi word", "*multi word italic*\n"],
  ])("%s", (_, input) => {
    expect(roundtrip(input)).toBe(input);
  });
});

// --- Code ---
describe("Roundtrip: Code `text`", () => {
  it.each([
    ["basic code", "`code`\n"],
    ["code in sentence", "text `code` more\n"],
    ["code with spaces", "`code with spaces`\n"],
    ["code at start", "`code` text\n"],
    ["code at end", "text `code`\n"],
  ])("%s", (_, input) => {
    expect(roundtrip(input)).toBe(input);
  });
});

// --- Strikethrough ---
describe("Roundtrip: Strike ~~text~~", () => {
  it.each([
    ["basic strike", "~~strike~~\n"],
    ["strike in sentence", "text ~~strike~~ more\n"],
    ["strike at start", "~~strike~~ text\n"],
    ["strike at end", "text ~~strike~~\n"],
    ["strike multi word", "~~multi word strike~~\n"],
  ])("%s", (_, input) => {
    expect(roundtrip(input)).toBe(input);
  });
});

// --- Link ---
describe("Roundtrip: Link [text](url)", () => {
  it.each([
    ["basic link", "[text](https://example.com)\n"],
    ["link with title", '[text](https://example.com "Title")\n'],
    ["link in sentence", "see [link](https://example.com) here\n"],
    ["link at start", "[link](https://example.com) text\n"],
    ["link at end", "text [link](https://example.com)\n"],
  ])("%s", (_, input) => {
    expect(roundtrip(input)).toBe(input);
  });
});

// --- Underline ---
describe("Roundtrip: Underline <u>text</u>", () => {
  it.each([
    ["basic underline", "<u>underlined</u>\n"],
    ["underline in sentence", "text <u>underlined</u> more\n"],
    ["underline at start", "<u>underlined</u> text\n"],
    ["underline at end", "text <u>underlined</u>\n"],
    ["underline multi word", "<u>multi word underline</u>\n"],
  ])("%s", (_, input) => {
    expect(roundtrip(input)).toBe(input);
  });
});

// --- Highlight ---
describe("Roundtrip: Highlight ==text==", () => {
  it.each([
    ["basic highlight", "==highlighted==\n"],
    ["highlight in sentence", "text ==highlighted== more\n"],
    ["highlight at start", "==highlighted== text\n"],
    ["highlight at end", "text ==highlighted==\n"],
    ["highlight multi word", "==multi word highlight==\n"],
  ])("%s", (_, input) => {
    expect(roundtrip(input)).toBe(input);
  });
});

// --- Subscript ---
describe("Roundtrip: Subscript ~text~", () => {
  it.each([
    ["basic subscript", "H~2~O\n"],
    ["subscript in sentence", "text ~sub~ more\n"],
    ["subscript at start", "~sub~ text\n"],
    ["subscript at end", "text ~sub~\n"],
  ])("%s", (_, input) => {
    expect(roundtrip(input)).toBe(input);
  });
});

// --- Superscript ---
describe("Roundtrip: Superscript ^text^", () => {
  it.each([
    ["basic superscript", "E = mc^2^\n"],
    ["superscript in sentence", "text ^sup^ more\n"],
    ["superscript at start", "^sup^ text\n"],
    ["superscript at end", "text ^sup^\n"],
  ])("%s", (_, input) => {
    expect(roundtrip(input)).toBe(input);
  });
});

// --- Nested marks ---
describe("Roundtrip: Nested marks", () => {
  it("bold + italic", () => {
    expect(roundtrip("***bold italic***\n")).toBe("***bold italic***\n");
  });

  it("bold wrapping code (code excludes other marks)", () => {
    // code mark excludes all other marks, so bold is stripped
    expect(roundtrip("**`bold code`**\n")).toBe("`bold code`\n");
  });

  it("link with bold text", () => {
    expect(roundtrip("[**bold link**](https://example.com)\n")).toBe(
      "[**bold link**](https://example.com)\n",
    );
  });

  it("strike with italic", () => {
    expect(roundtrip("~~*strike italic*~~\n")).toBe("~~*strike italic*~~\n");
  });

  it("all standard marks in one paragraph", () => {
    const input =
      "**bold** *italic* `code` ~~strike~~ [link](https://example.com)\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("all custom marks in one paragraph", () => {
    const input = "==highlight== ~sub~ ^sup^ <u>underline</u>\n";
    expect(roundtrip(input)).toBe(input);
  });
});

// --- Marks in block contexts ---
describe("Roundtrip: Marks in block contexts", () => {
  it("bold in heading", () => {
    expect(roundtrip("## **bold** heading\n")).toBe("## **bold** heading\n");
  });

  it("italic in blockquote", () => {
    expect(roundtrip("> *italic* quote\n")).toBe("> *italic* quote\n");
  });

  it("code in list item", () => {
    expect(roundtrip("- item with `code`\n")).toBe("- item with `code`\n");
  });

  it("link in ordered list", () => {
    expect(roundtrip("1. see [link](https://example.com)\n")).toBe(
      "1. see [link](https://example.com)\n",
    );
  });
});
