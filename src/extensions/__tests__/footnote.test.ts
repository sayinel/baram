import { Schema } from "@tiptap/pm/model";
// §footnote Footnote Extension — roundtrip + structure tests
import { describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";

// Schema with footnoteRef + footnoteDefinition
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
    footnoteRef: {
      group: "inline",
      inline: true,
      atom: true,
      marks: "",
      attrs: { identifier: { default: "1" } },
    },
    footnoteDefinition: {
      content: "block+",
      group: "block",
      defining: true,
      attrs: { identifier: { default: "1" } },
    },
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

// ── Roundtrip tests ─────────────────────────────────────────────────

describe("Roundtrip: Footnote", () => {
  it("single footnote", () => {
    const input = "Some text[^1].\n\n[^1]: Footnote content.\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("multiple footnotes", () => {
    const input =
      "First[^1] and second[^2].\n\n[^1]: First note.\n\n[^2]: Second note.\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("named footnote identifier", () => {
    const input = "Text[^note].\n\n[^note]: Named footnote.\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("definition with inline formatting", () => {
    const input = "Text[^1].\n\n[^1]: **bold** and *italic*\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("footnote ref mid-sentence", () => {
    const input =
      "This is a footnote[^1] in the middle of a sentence.\n\n[^1]: Some note.\n";
    expect(roundtrip(input)).toBe(input);
  });
});

// ── PM structure tests ──────────────────────────────────────────────

describe("Footnote PM structure", () => {
  it("creates footnoteRef node with correct attrs", () => {
    const input = "Text[^1].\n\n[^1]: Content.\n";
    const doc = markdownToProsemirror(input, schema);

    // First child: paragraph containing text + footnoteRef + text
    const para = doc.firstChild!;
    expect(para.type.name).toBe("paragraph");

    let foundRef = false;
    para.forEach((child) => {
      if (child.type.name === "footnoteRef") {
        expect(child.attrs.identifier).toBe("1");
        foundRef = true;
      }
    });
    expect(foundRef).toBe(true);
  });

  it("creates footnoteDefinition node with correct attrs", () => {
    const input = "Text[^1].\n\n[^1]: Definition content.\n";
    const doc = markdownToProsemirror(input, schema);

    // Second child: footnoteDefinition
    const fnDef = doc.child(1);
    expect(fnDef.type.name).toBe("footnoteDefinition");
    expect(fnDef.attrs.identifier).toBe("1");
  });

  it("footnoteDefinition contains block children", () => {
    const input = "Text[^1].\n\n[^1]: First paragraph.\n";
    const doc = markdownToProsemirror(input, schema);
    const fnDef = doc.child(1);
    expect(fnDef.childCount).toBeGreaterThanOrEqual(1);
    expect(fnDef.firstChild!.type.name).toBe("paragraph");
  });

  it("named identifier preserved", () => {
    const input = "Text[^myref].\n\n[^myref]: Named definition.\n";
    const doc = markdownToProsemirror(input, schema);

    let refIdentifier = "";
    doc.firstChild!.forEach((child) => {
      if (child.type.name === "footnoteRef") {
        refIdentifier = child.attrs.identifier as string;
      }
    });
    expect(refIdentifier).toBe("myref");

    const fnDef = doc.child(1);
    expect(fnDef.attrs.identifier).toBe("myref");
  });

  it("multiple footnote definitions are separate blocks", () => {
    const input = "A[^1] B[^2].\n\n[^1]: First.\n\n[^2]: Second.\n";
    const doc = markdownToProsemirror(input, schema);

    expect(doc.childCount).toBe(3); // paragraph + 2 definitions
    expect(doc.child(1).type.name).toBe("footnoteDefinition");
    expect(doc.child(1).attrs.identifier).toBe("1");
    expect(doc.child(2).type.name).toBe("footnoteDefinition");
    expect(doc.child(2).attrs.identifier).toBe("2");
  });
});
