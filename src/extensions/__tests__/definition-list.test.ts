// Definition List Extension — roundtrip + PM structure tests
import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";

// Schema with definition list nodes
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
      attrs: { level: { default: 1 }, blockId: { default: null } },
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
    definitionList: {
      content: "(definitionTerm definitionDescription+)+",
      group: "block",
      defining: true,
    },
    definitionTerm: {
      content: "inline*",
      marks: "_",
    },
    definitionDescription: {
      content: "inline*",
      marks: "_",
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

function roundtrip(md: string): string {
  const doc = markdownToProsemirror(md, schema);
  return prosemirrorToMarkdown(doc);
}

describe("Definition List Extension", () => {
  describe("Roundtrip", () => {
    it("single term + single definition", () => {
      const input = "Term\n: Definition";
      const output = roundtrip(input);
      expect(output.trim()).toBe(input);
    });

    it("single term + multiple definitions", () => {
      const input = "Term\n: Definition 1\n: Definition 2";
      const output = roundtrip(input);
      expect(output.trim()).toBe(input);
    });

    it("multiple term-definition groups", () => {
      const input = "Term 1\n: Definition 1\n\nTerm 2\n: Definition 2";
      const output = roundtrip(input);
      expect(output.trim()).toBe(input);
    });

    it("definition with bold inline mark", () => {
      const input = "Term\n: **Bold** definition";
      const output = roundtrip(input);
      expect(output.trim()).toBe(input);
    });

    it("term with italic inline mark", () => {
      const input = "*Italic term*\n: Definition";
      const output = roundtrip(input);
      expect(output.trim()).toBe(input);
    });

    it("definition with inline code", () => {
      const input = "Term\n: `code` in definition";
      const output = roundtrip(input);
      expect(output.trim()).toBe(input);
    });
  });

  describe("PM structure", () => {
    it("creates definitionList with term + description", () => {
      const doc = markdownToProsemirror("Term\n: Definition", schema);
      const dl = doc.child(0);
      expect(dl.type.name).toBe("definitionList");
      expect(dl.childCount).toBe(2);
      expect(dl.child(0).type.name).toBe("definitionTerm");
      expect(dl.child(0).textContent).toBe("Term");
      expect(dl.child(1).type.name).toBe("definitionDescription");
      expect(dl.child(1).textContent).toBe("Definition");
    });

    it("creates multiple descriptions for one term", () => {
      const doc = markdownToProsemirror(
        "Term\n: Def 1\n: Def 2",
        schema,
      );
      const dl = doc.child(0);
      expect(dl.childCount).toBe(3);
      expect(dl.child(0).type.name).toBe("definitionTerm");
      expect(dl.child(1).type.name).toBe("definitionDescription");
      expect(dl.child(1).textContent).toBe("Def 1");
      expect(dl.child(2).type.name).toBe("definitionDescription");
      expect(dl.child(2).textContent).toBe("Def 2");
    });

    it("creates multiple groups separated by blank line", () => {
      const doc = markdownToProsemirror(
        "Term 1\n: Def 1\n\nTerm 2\n: Def 2",
        schema,
      );
      const dl = doc.child(0);
      expect(dl.childCount).toBe(4);
      expect(dl.child(0).textContent).toBe("Term 1");
      expect(dl.child(1).textContent).toBe("Def 1");
      expect(dl.child(2).textContent).toBe("Term 2");
      expect(dl.child(3).textContent).toBe("Def 2");
    });
  });

  describe("False positive prevention", () => {
    it("does not convert paragraph not followed by definition", () => {
      const doc = markdownToProsemirror("Just a paragraph", schema);
      expect(doc.child(0).type.name).toBe("paragraph");
    });

    it("does not convert paragraph followed by non-definition paragraph", () => {
      const doc = markdownToProsemirror("First\n\nSecond", schema);
      expect(doc.child(0).type.name).toBe("paragraph");
      expect(doc.child(1).type.name).toBe("paragraph");
    });

    it("does not convert when first paragraph starts with colon", () => {
      const doc = markdownToProsemirror(": Not a definition\n\nSomething", schema);
      expect(doc.child(0).type.name).toBe("paragraph");
    });
  });
});
