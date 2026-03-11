// §5.13 Query Block — roundtrip + structure tests
import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";

// Schema with queryBlock node
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
    mathBlock: {
      content: "text*",
      group: "block",
      marks: "",
      code: true,
      attrs: { formula: { default: "" } },
    },
    queryBlock: {
      group: "block",
      atom: true,
      attrs: { query: { default: "" } },
    },
    text: { group: "inline" },
  },
  marks: {
    bold: {},
    italic: {},
    code: {},
    strike: {},
    link: {
      attrs: {
        href: { default: null },
        title: { default: null },
      },
    },
  },
});

function roundtrip(md: string): string {
  const doc = markdownToProsemirror(md, schema);
  return prosemirrorToMarkdown(doc).trimEnd();
}

function parse(md: string) {
  return markdownToProsemirror(md, schema);
}

describe("QueryBlock Extension", () => {
  describe("roundtrip preservation", () => {
    it("simple query", () => {
      const md = "```query\ntag:#journal\n```";
      expect(roundtrip(md)).toBe(md);
    });

    it("multi-line query with filters", () => {
      const md = "```query\ntag:#daily\npath:journal/\nsort:date-desc\n```";
      expect(roundtrip(md)).toBe(md);
    });

    it("query with limit", () => {
      const md = "```query\ntag:#project\nlimit:10\n```";
      expect(roundtrip(md)).toBe(md);
    });

    it("empty query block", () => {
      const md = "```query\n```";
      expect(roundtrip(md)).toBe(md);
    });

    it("query block surrounded by paragraphs", () => {
      const md = "Before\n\n```query\ntag:#test\n```\n\nAfter";
      expect(roundtrip(md)).toBe(md);
    });

    it("query block after heading", () => {
      const md = "# Heading\n\n```query\ntag:#heading\n```";
      expect(roundtrip(md)).toBe(md);
    });
  });

  describe("PM structure", () => {
    it("parses as queryBlock node with query attr", () => {
      const doc = parse("```query\ntag:#test\n```");
      const queryNode = doc.firstChild!;
      expect(queryNode.type.name).toBe("queryBlock");
      expect(queryNode.attrs.query).toBe("tag:#test");
    });

    it("queryBlock is atom (no children)", () => {
      const doc = parse("```query\ntag:#test\n```");
      const queryNode = doc.firstChild!;
      expect(queryNode.childCount).toBe(0);
    });

    it("multi-line query preserved in attr", () => {
      const doc = parse(
        "```query\ntag:#daily\npath:journal/\nsort:date-desc\n```",
      );
      const queryNode = doc.firstChild!;
      expect(queryNode.attrs.query).toBe(
        "tag:#daily\npath:journal/\nsort:date-desc",
      );
    });

    it("non-query code block stays as codeBlock", () => {
      const doc = parse("```javascript\nconsole.log('hi')\n```");
      const codeNode = doc.firstChild!;
      expect(codeNode.type.name).toBe("codeBlock");
      expect(codeNode.attrs.language).toBe("javascript");
    });

    it("empty query has empty string attr", () => {
      const doc = parse("```query\n```");
      const queryNode = doc.firstChild!;
      expect(queryNode.type.name).toBe("queryBlock");
      expect(queryNode.attrs.query).toBe("");
    });
  });
});
