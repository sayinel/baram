// Stability test: simulate multiple Source ↔ WYSIWYG toggle cycles
// Reproduces: "편집모드에서 WYSIWYG 모드로 돌아올 때마다 한 라인씩 사라져"
import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { markdownToProsemirror } from "../md-to-pm";
import { prosemirrorToMarkdown } from "../pm-to-md";

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
    hardBreak: { inline: true, group: "inline" },
    text: { group: "inline" },
    // M3 nodes
    mathBlock: {
      content: "text*",
      group: "block",
      marks: "",
      code: true,
      attrs: { math: { default: "" } },
    },
    mathInline: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { math: { default: "" } },
    },
    frontmatter: {
      content: "text*",
      group: "block",
      marks: "",
      code: true,
      attrs: { language: { default: "yaml" } },
    },
    table: { content: "tableRow+", group: "block" },
    tableRow: { content: "(tableCell | tableHeader)+" },
    tableHeader: {
      content: "paragraph",
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        alignment: { default: null },
      },
    },
    tableCell: {
      content: "paragraph",
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        alignment: { default: null },
      },
    },
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
  },
});

/** Simulate N toggle cycles: PM → MD → PM → MD → ... */
function multiRoundtrip(input: string, cycles: number): string[] {
  const results: string[] = [];
  let md = input;
  for (let i = 0; i < cycles; i++) {
    const doc = markdownToProsemirror(md, schema);
    md = prosemirrorToMarkdown(doc);
    results.push(md);
  }
  return results;
}

/** Start from PM doc (like the editor creates) → MD → PM → MD → ... */
function multiRoundtripFromPm(
  createDoc: () => ReturnType<typeof schema.nodes.doc.create>,
  cycles: number,
): string[] {
  const results: string[] = [];
  // First cycle: PM → MD
  const doc0 = createDoc();
  let md = prosemirrorToMarkdown(doc0);
  results.push(md);
  // Subsequent cycles: MD → PM → MD
  for (let i = 1; i < cycles; i++) {
    const doc = markdownToProsemirror(md, schema);
    md = prosemirrorToMarkdown(doc);
    results.push(md);
  }
  return results;
}

/**
 * Simulate N toggle cycles WITH JSON serialization (like the real app):
 * MD → PM → toJSON → fromJSON → MD → PM → toJSON → fromJSON → MD → ...
 * This matches what Tiptap's setContent does: schema.nodeFromJSON(doc.toJSON())
 */
function multiRoundtripWithJson(input: string, cycles: number): string[] {
  const results: string[] = [];
  let md = input;
  for (let i = 0; i < cycles; i++) {
    const doc = markdownToProsemirror(md, schema);
    // Simulate setContent: toJSON → nodeFromJSON (like Tiptap does)
    const json = doc.toJSON();
    const docFromJson = schema.nodeFromJSON(json);
    md = prosemirrorToMarkdown(docFromJson);
    results.push(md);
  }
  return results;
}

describe("JSON round-trip stability (simulates Tiptap setContent)", () => {
  it("simple paragraphs stable with JSON over 5 cycles", () => {
    const input = "First paragraph\n\nSecond paragraph\n\nThird paragraph\n";
    const results = multiRoundtripWithJson(input, 5);
    for (const r of results) {
      expect(r).toBe(input);
    }
  });

  it("heading + paragraphs stable with JSON over 5 cycles", () => {
    const input = "# Title\n\nFirst paragraph\n\nSecond paragraph\n";
    const results = multiRoundtripWithJson(input, 5);
    for (const r of results) {
      expect(r).toBe(input);
    }
  });

  it("mixed content stable with JSON over 5 cycles", () => {
    const input = [
      "# Title",
      "",
      "A paragraph with **bold** and *italic*.",
      "",
      "> A blockquote",
      "",
      "- Item 1",
      "- Item 2",
      "",
      "```javascript",
      "const x = 1;",
      "```",
      "",
    ].join("\n");
    const results = multiRoundtripWithJson(input, 5);
    for (const r of results) {
      expect(r).toBe(input);
    }
  });

  it("5 paragraphs — line count should not decrease with JSON", () => {
    const input = "Line 1\n\nLine 2\n\nLine 3\n\nLine 4\n\nLine 5\n";
    const results = multiRoundtripWithJson(input, 10);
    const lineCount = input.split("\n").length;
    for (const r of results) {
      expect(r.split("\n").length).toBe(lineCount);
    }
  });

  it("toJSON → fromJSON preserves doc structure exactly", () => {
    const input = "# Title\n\nParagraph 1\n\nParagraph 2\n\nParagraph 3\n";
    const doc = markdownToProsemirror(input, schema);
    const json = doc.toJSON();
    const docFromJson = schema.nodeFromJSON(json);

    // Structure should be identical
    expect(docFromJson.childCount).toBe(doc.childCount);
    expect(docFromJson.toJSON()).toEqual(doc.toJSON());

    // Serialized markdown should be identical
    const md1 = prosemirrorToMarkdown(doc);
    const md2 = prosemirrorToMarkdown(docFromJson);
    expect(md2).toBe(md1);
  });
});

describe("setContent simulation (replaceWith + JSON round-trip)", () => {
  it("replaceWith(doc.content) preserves content correctly", () => {
    const input = "Line 1\n\nLine 2\n\nLine 3\n\nLine 4\n\nLine 5\n";
    const newDoc = markdownToProsemirror(input, schema);
    const baseDoc = markdownToProsemirror("Placeholder\n", schema);

    const state = EditorState.create({ schema, doc: baseDoc });
    const tr = state.tr;
    tr.replaceWith(0, tr.doc.content.size, newDoc.content);

    expect(tr.doc.childCount).toBe(newDoc.childCount);
    expect(prosemirrorToMarkdown(tr.doc)).toBe(input);
  });

  it("replaceWith(full doc node) preserves content correctly", () => {
    const input = "Line 1\n\nLine 2\n\nLine 3\n\nLine 4\n\nLine 5\n";
    const newDoc = markdownToProsemirror(input, schema);
    const baseDoc = markdownToProsemirror("Placeholder\n", schema);

    const state = EditorState.create({ schema, doc: baseDoc });
    const tr = state.tr;
    tr.replaceWith(0, tr.doc.content.size, newDoc);

    expect(tr.doc.childCount).toBe(newDoc.childCount);
    expect(prosemirrorToMarkdown(tr.doc)).toBe(input);
  });

  it("multi-cycle setContent simulation stable over 5 cycles", () => {
    let md = "Line 1\n\nLine 2\n\nLine 3\n\nLine 4\n\nLine 5\n";
    const origLineCount = md.split("\n").length;
    let currentDoc = markdownToProsemirror(md, schema);

    for (let cycle = 0; cycle < 5; cycle++) {
      const newDoc = markdownToProsemirror(md, schema);
      const json = newDoc.toJSON();
      const docFromJson = schema.nodeFromJSON(json);

      const state = EditorState.create({ schema, doc: currentDoc });
      const tr = state.tr;
      tr.replaceWith(0, tr.doc.content.size, docFromJson);
      currentDoc = tr.doc;
      md = prosemirrorToMarkdown(currentDoc);
    }

    expect(md.split("\n").length).toBe(origLineCount);
    expect(md).toBe("Line 1\n\nLine 2\n\nLine 3\n\nLine 4\n\nLine 5\n");
  });
});

describe("Multi-roundtrip stability", () => {
  it("simple paragraphs stable over 5 cycles", () => {
    const input = "First paragraph\n\nSecond paragraph\n\nThird paragraph\n";
    const results = multiRoundtrip(input, 5);
    for (const r of results) {
      expect(r).toBe(input);
    }
  });

  it("heading + paragraphs stable over 5 cycles", () => {
    const input = "# Title\n\nFirst paragraph\n\nSecond paragraph\n";
    const results = multiRoundtrip(input, 5);
    for (const r of results) {
      expect(r).toBe(input);
    }
  });

  it("mixed content stable over 5 cycles", () => {
    const input = [
      "# Title",
      "",
      "A paragraph with **bold** and *italic*.",
      "",
      "> A blockquote",
      "",
      "- Item 1",
      "- Item 2",
      "",
      "```javascript",
      "const x = 1;",
      "```",
      "",
    ].join("\n");
    const results = multiRoundtrip(input, 5);
    for (const r of results) {
      expect(r).toBe(input);
    }
  });

  it("PM-origin doc: paragraphs stable over 5 cycles", () => {
    const results = multiRoundtripFromPm(
      () =>
        schema.nodes.doc.create(null, [
          schema.nodes.paragraph.create(null, [schema.text("Line 1")]),
          schema.nodes.paragraph.create(null, [schema.text("Line 2")]),
          schema.nodes.paragraph.create(null, [schema.text("Line 3")]),
        ]),
      5,
    );
    // All cycles should produce identical markdown
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBe(results[0]);
    }
  });

  it("PM-origin doc: trailing empty paragraph", () => {
    const results = multiRoundtripFromPm(
      () =>
        schema.nodes.doc.create(null, [
          schema.nodes.paragraph.create(null, [schema.text("Hello")]),
          schema.nodes.paragraph.create(null, [schema.text("World")]),
          schema.nodes.paragraph.create(null), // empty paragraph
        ]),
      5,
    );
    // After first cycle, should stabilize
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBe(results[1]);
    }
  });

  it("PM-origin doc: multiple empty paragraphs", () => {
    const results = multiRoundtripFromPm(
      () =>
        schema.nodes.doc.create(null, [
          schema.nodes.paragraph.create(null, [schema.text("Hello")]),
          schema.nodes.paragraph.create(null), // empty
          schema.nodes.paragraph.create(null, [schema.text("World")]),
        ]),
      5,
    );
    // After first cycle, should stabilize
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBe(results[1]);
    }
  });

  it("PM-origin doc: heading + code + list", () => {
    const results = multiRoundtripFromPm(
      () =>
        schema.nodes.doc.create(null, [
          schema.nodes.heading.create({ level: 2 }, [
            schema.text("My Title"),
          ]),
          schema.nodes.paragraph.create(null, [
            schema.text("Some text here"),
          ]),
          schema.nodes.codeBlock.create({ language: "js" }, [
            schema.text("const a = 1;"),
          ]),
          schema.nodes.bulletList.create(null, [
            schema.nodes.listItem.create(null, [
              schema.nodes.paragraph.create(null, [schema.text("Item A")]),
            ]),
            schema.nodes.listItem.create(null, [
              schema.nodes.paragraph.create(null, [schema.text("Item B")]),
            ]),
          ]),
        ]),
      5,
    );
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBe(results[0]);
    }
  });

  it("line count should not decrease across cycles", () => {
    const input = "Line 1\n\nLine 2\n\nLine 3\n\nLine 4\n\nLine 5\n";
    const results = multiRoundtrip(input, 10);
    const lineCount = input.split("\n").length;
    for (const r of results) {
      expect(r.split("\n").length).toBe(lineCount);
    }
  });
});
