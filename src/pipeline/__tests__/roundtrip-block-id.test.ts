import { Schema } from "@tiptap/pm/model";
// §30a Block ID roundtrip tests — MD → ProseMirror → MD
import { describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../md-to-pm";
import { prosemirrorToMarkdown } from "../pm-to-md";

// Schema with blockId attribute on paragraph and heading
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      marks: "_",
      attrs: { blockId: { default: null } },
    },
    heading: {
      content: "inline*",
      group: "block",
      attrs: {
        level: { default: 1 },
        blockId: { default: null },
      },
    },
    blockquote: { content: "block+", group: "block" },
    bulletList: { content: "listItem+", group: "block" },
    orderedList: {
      content: "listItem+",
      group: "block",
      attrs: { start: { default: 1 } },
    },
    listItem: { content: "paragraph block*" },
    taskList: { content: "taskItem+", group: "block" },
    taskItem: {
      content: "paragraph block*",
      attrs: { checked: { default: false } },
    },
    horizontalRule: { group: "block" },
    image: {
      group: "block",
      atom: true,
      attrs: {
        src: { default: null },
        alt: { default: null },
        title: { default: null },
      },
    },
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
  },
});

function roundtrip(input: string): string {
  const doc = markdownToProsemirror(input, schema);
  return prosemirrorToMarkdown(doc);
}

describe("§30a Block ID Roundtrip", () => {
  it("paragraph with block ID", () => {
    const input = "This is a paragraph. ^abc123\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("heading with block ID", () => {
    const input = "# Heading ^def456\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("H2 heading with block ID", () => {
    const input = "## Sub heading ^h2id\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("paragraph without block ID (unchanged)", () => {
    const input = "Just a normal paragraph.\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("bold text followed by block ID", () => {
    const input = "**bold text** ^bid1\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("italic text followed by block ID", () => {
    const input = "*italic text* ^bid2\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("mixed inline marks and block ID", () => {
    const input = "text **bold** and *italic* ^myid\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("middle caret is NOT extracted as block ID", () => {
    const input = "x^2 is a formula\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("multiple paragraphs, some with IDs", () => {
    const input =
      "First paragraph ^id1\n\nSecond paragraph\n\nThird paragraph ^id3\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("blockquote with paragraph block ID", () => {
    const input = "> quoted text ^bqid\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("block ID with hyphen", () => {
    const input = "text ^my-block-id\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("block ID with underscore (remark escapes _ to \\_)", () => {
    const input = "text ^block_id_1\n";
    // remark-stringify escapes _ in text; data is preserved, raw form stabilizes
    expect(roundtrip(input)).toBe("text ^block\\_id\\_1\n");
  });

  it("list item paragraph with block ID", () => {
    const input = "- list item ^lid1\n";
    expect(roundtrip(input)).toBe(input);
  });
});

describe("§30a Block ID PM Structure", () => {
  it("paragraph node has blockId attribute", () => {
    const doc = markdownToProsemirror("Hello world ^abc\n", schema);
    const para = doc.firstChild!;
    expect(para.type.name).toBe("paragraph");
    expect(para.attrs.blockId).toBe("abc");
    expect(para.textContent).toBe("Hello world");
  });

  it("heading node has blockId attribute", () => {
    const doc = markdownToProsemirror("# Title ^h1id\n", schema);
    const heading = doc.firstChild!;
    expect(heading.type.name).toBe("heading");
    expect(heading.attrs.blockId).toBe("h1id");
    expect(heading.attrs.level).toBe(1);
    expect(heading.textContent).toBe("Title");
  });

  it("paragraph without block ID has null blockId", () => {
    const doc = markdownToProsemirror("No block id here\n", schema);
    const para = doc.firstChild!;
    expect(para.attrs.blockId).toBeNull();
  });

  it("caret in middle of text does not create blockId", () => {
    const doc = markdownToProsemirror("x^2 formula\n", schema);
    const para = doc.firstChild!;
    expect(para.attrs.blockId).toBeNull();
    expect(para.textContent).toBe("x^2 formula");
  });

  it("blockquote inner paragraph gets blockId", () => {
    const doc = markdownToProsemirror("> quoted ^qid\n", schema);
    const bq = doc.firstChild!;
    expect(bq.type.name).toBe("blockquote");
    const para = bq.firstChild!;
    expect(para.type.name).toBe("paragraph");
    expect(para.attrs.blockId).toBe("qid");
    expect(para.textContent).toBe("quoted");
  });
});
