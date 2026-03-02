// §56m Tag Node tests — regex + serialization + roundtrip
import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import { serializeTag, TAG_NODE_RE } from "../../pipeline/transformers/tag-transformer";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", marks: "_" },
    heading: { content: "inline*", group: "block", attrs: { level: { default: 1 } } },
    blockquote: { content: "block+", group: "block" },
    bulletList: { content: "listItem+", group: "block" },
    orderedList: { content: "listItem+", group: "block", attrs: { start: { default: 1 } } },
    listItem: { content: "paragraph block*" },
    codeBlock: { content: "text*", group: "block", marks: "", code: true, attrs: { language: { default: null } } },
    tagNode: { group: "inline", inline: true, atom: true, marks: "", attrs: { tag: { default: "" } } },
    hardBreak: { inline: true, group: "inline" },
    text: { group: "inline" },
  },
  marks: { bold: {}, italic: {}, code: { excludes: "_" }, strike: {} },
});

function roundtrip(input: string): string {
  const doc = markdownToProsemirror(input, schema);
  return prosemirrorToMarkdown(doc);
}

describe("Tag Node", () => {
  describe("TAG_NODE_RE", () => {
    it("matches simple tag", () => {
      const text = "Hello #world tag";
      const matches = [...text.matchAll(new RegExp(TAG_NODE_RE.source, "g"))];
      expect(matches).toHaveLength(1);
      expect(matches[0][1]).toBe("world");
    });

    it("matches tag at start of string", () => {
      const text = "#project is great";
      const matches = [...text.matchAll(new RegExp(TAG_NODE_RE.source, "g"))];
      expect(matches).toHaveLength(1);
      expect(matches[0][1]).toBe("project");
    });

    it("matches nested tag with slash", () => {
      const text = "#project/baram is great";
      const matches = [...text.matchAll(new RegExp(TAG_NODE_RE.source, "g"))];
      expect(matches).toHaveLength(1);
      expect(matches[0][1]).toBe("project/baram");
    });

    it("matches Korean tag", () => {
      const text = "오늘 #일기 쓰기";
      const matches = [...text.matchAll(new RegExp(TAG_NODE_RE.source, "g"))];
      expect(matches).toHaveLength(1);
      expect(matches[0][1]).toBe("일기");
    });

    it("matches multiple tags", () => {
      const text = "#hello and #world";
      const matches = [...text.matchAll(new RegExp(TAG_NODE_RE.source, "g"))];
      expect(matches).toHaveLength(2);
      expect(matches[0][1]).toBe("hello");
      expect(matches[1][1]).toBe("world");
    });

    it("does not match heading (space after #)", () => {
      // "# Heading" has space after #, not word char
      const text = "# Heading text";
      const matches = [...text.matchAll(new RegExp(TAG_NODE_RE.source, "g"))];
      expect(matches).toHaveLength(0);
    });

    it("does not match mid-word hash", () => {
      // "abc#def" — # is not at start or after whitespace
      const text = "abc#def";
      const matches = [...text.matchAll(new RegExp(TAG_NODE_RE.source, "g"))];
      expect(matches).toHaveLength(0);
    });
  });

  describe("roundtrip", () => {
    it.each([
      ["tag in middle", "Hello #world tag"],
      ["tag at start", "#project is great"],
      ["multiple tags", "#hello and #world"],
      ["Korean tag", "오늘 #일기 쓰기"],
      ["nested tag", "#project/baram nested"],
      ["tag at end", "text #end"],
      ["tag with trailing space", "text #end "],
    ])("%s: roundtrip preserves %s", (_label, input) => {
      const output = roundtrip(input);
      // remark-stringify adds trailing newline; strip for comparison
      expect(output.replace(/\n$/, "")).toBe(input.trimEnd());
    });

    it("no &#x20; when tagNode followed by space-only text node", () => {
      // Simulates InputRule: tagNode + text(" ") at end of paragraph
      const doc = schema.node("doc", null, [
        schema.node("paragraph", null, [
          schema.text("Hello "),
          schema.nodes.tagNode.create({ tag: "world" }),
          schema.text(" "),
        ]),
      ]);
      const md = prosemirrorToMarkdown(doc);
      expect(md).not.toContain("&#x20;");
      expect(md.replace(/\n$/, "")).toBe("Hello #world");
    });
  });

  describe("serializeTag", () => {
    it("serializes simple tag", () => {
      expect(serializeTag({ tag: "world" })).toBe("#world");
    });

    it("serializes nested tag", () => {
      expect(serializeTag({ tag: "project/baram" })).toBe("#project/baram");
    });

    it("serializes Korean tag", () => {
      expect(serializeTag({ tag: "일기" })).toBe("#일기");
    });
  });
});
