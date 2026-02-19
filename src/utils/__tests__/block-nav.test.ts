// §30c block-nav utility tests
import { describe, test, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { findBlockLine, findBlockPosById, findBlockContent } from "../block-nav";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";

// Minimal schema with blockId attribute on paragraph and heading
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      marks: "_",
      attrs: { blockId: { default: null } },
      parseDOM: [{ tag: "p" }],
      toDOM() { return ["p", 0]; },
    },
    heading: {
      content: "inline*",
      group: "block",
      marks: "_",
      attrs: { level: { default: 1 }, blockId: { default: null } },
      parseDOM: [
        { tag: "h1", attrs: { level: 1 } },
        { tag: "h2", attrs: { level: 2 } },
      ],
      toDOM(node) { return [`h${node.attrs.level}`, 0]; },
    },
    text: { group: "inline" },
    hard_break: { group: "inline", inline: true, parseDOM: [{ tag: "br" }], toDOM() { return ["br"]; } },
  },
  marks: {},
});

describe("findBlockLine", () => {
  test("finds block ID at end of paragraph", () => {
    const content = "First line\nSome text ^abc123\nThird line";
    expect(findBlockLine(content, "abc123")).toBe(2);
  });

  test("finds block ID at end of heading", () => {
    const content = "# Title ^h1\nParagraph text";
    expect(findBlockLine(content, "h1")).toBe(1);
  });

  test("returns null when block ID not found", () => {
    const content = "No block IDs here\nJust text";
    expect(findBlockLine(content, "missing")).toBe(null);
  });

  test("matches first occurrence when duplicate block IDs", () => {
    const content = "First ^dup\nSecond ^dup";
    expect(findBlockLine(content, "dup")).toBe(1);
  });

  test("does not match mid-line block ID pattern", () => {
    const content = "Text ^abc123 more text";
    expect(findBlockLine(content, "abc123")).toBe(null);
  });
});

describe("findBlockPosById", () => {
  test("finds paragraph with blockId", () => {
    const md = "Some text ^myid";
    const doc = markdownToProsemirror(md, schema);
    const pos = findBlockPosById(doc, "myid");
    expect(pos).not.toBe(null);
    const node = doc.nodeAt(pos!);
    expect(node?.type.name).toBe("paragraph");
    expect(node?.attrs.blockId).toBe("myid");
  });

  test("finds heading with blockId", () => {
    const md = "## Heading ^hid";
    const doc = markdownToProsemirror(md, schema);
    const pos = findBlockPosById(doc, "hid");
    expect(pos).not.toBe(null);
    const node = doc.nodeAt(pos!);
    expect(node?.type.name).toBe("heading");
    expect(node?.attrs.blockId).toBe("hid");
  });

  test("returns null when blockId not found", () => {
    const md = "Plain text";
    const doc = markdownToProsemirror(md, schema);
    const pos = findBlockPosById(doc, "notfound");
    expect(pos).toBe(null);
  });
});

describe("findBlockContent", () => {
  test("extracts paragraph text without suffix", () => {
    const content = "Hello world ^blk1\nNext line";
    expect(findBlockContent(content, "blk1")).toBe("Hello world");
  });

  test("extracts heading text without prefix and suffix", () => {
    const content = "## My Heading ^hblk\nParagraph";
    expect(findBlockContent(content, "hblk")).toBe("My Heading");
  });

  test("returns null when block not found", () => {
    const content = "No blocks here";
    expect(findBlockContent(content, "nope")).toBe(null);
  });

  test("handles empty text before suffix", () => {
    const content = " ^emptyish";
    expect(findBlockContent(content, "emptyish")).toBe("");
  });
});
