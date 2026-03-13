import { Schema } from "@tiptap/pm/model";
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
  marks: { bold: {}, italic: {}, code: { excludes: "_" }, strike: {} },
});

function roundtrip(input: string): string {
  const doc = markdownToProsemirror(input, schema);
  return prosemirrorToMarkdown(doc);
}

describe("empty list item roundtrip", () => {
  it("roundtrip preserves empty list item between items", () => {
    const input = "- item 1\n-\n- item 3";
    expect(roundtrip(input).replace(/\n$/, "")).toBe(input);
  });

  it("roundtrip preserves empty list item at end", () => {
    const input = "- item 1\n-";
    expect(roundtrip(input).replace(/\n$/, "")).toBe(input);
  });

  it("empty listItem always has paragraph child after parse", () => {
    const input = "- item 1\n-\n- item 3";
    const doc = markdownToProsemirror(input, schema);
    // Second listItem should have a paragraph child (not empty content)
    const list = doc.firstChild!;
    const emptyItem = list.child(1);
    expect(emptyItem.type.name).toBe("listItem");
    expect(emptyItem.childCount).toBe(1);
    expect(emptyItem.firstChild!.type.name).toBe("paragraph");
  });

  it("WYSIWYG → source → WYSIWYG preserves empty item structure", () => {
    // Simulate WYSIWYG doc with empty list item
    const doc = schema.node("doc", null, [
      schema.node("bulletList", null, [
        schema.node("listItem", null, [
          schema.node("paragraph", null, [schema.text("item 1")]),
        ]),
        schema.node("listItem", null, [schema.node("paragraph", null, [])]),
        schema.node("listItem", null, [
          schema.node("paragraph", null, [schema.text("item 3")]),
        ]),
      ]),
    ]);

    // Serialize to markdown (entering source mode)
    const md = prosemirrorToMarkdown(doc);

    // Parse back (leaving source mode)
    const doc2 = markdownToProsemirror(md, schema);

    // Empty listItem must still have paragraph child for cursor placement
    const list = doc2.firstChild!;
    expect(list.childCount).toBe(3);
    const emptyItem = list.child(1);
    expect(emptyItem.type.name).toBe("listItem");
    expect(emptyItem.childCount).toBe(1);
    expect(emptyItem.firstChild!.type.name).toBe("paragraph");
  });
});
