// Table of Contents Extension — roundtrip + functionality tests
import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
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
    tableOfContents: { group: "block", atom: true },
    hardBreak: { inline: true, group: "inline" },
    text: { group: "inline" },
  },
  marks: {
    bold: {},
  },
});

function roundtrip(input: string): string {
  const doc = markdownToProsemirror(input, schema);
  return prosemirrorToMarkdown(doc);
}

describe("Table of Contents: Roundtrip", () => {
  it("[TOC] basic roundtrip", () => {
    expect(roundtrip("[TOC]\n")).toBe("[TOC]\n");
  });

  it("[toc] lowercase roundtrip (normalizes to uppercase)", () => {
    expect(roundtrip("[toc]\n")).toBe("[TOC]\n");
  });

  it("[TOC] with surrounding content", () => {
    const input = "# Title\n\n[TOC]\n\n## Section\n";
    expect(roundtrip(input)).toBe(input);
  });
});

describe("Table of Contents: Parsing", () => {
  it("creates tableOfContents node for [TOC]", () => {
    const doc = markdownToProsemirror("[TOC]\n", schema);
    expect(doc.firstChild!.type.name).toBe("tableOfContents");
  });

  it("creates tableOfContents node for [toc]", () => {
    const doc = markdownToProsemirror("[toc]\n", schema);
    expect(doc.firstChild!.type.name).toBe("tableOfContents");
  });

  it("[TOC] with extra text stays as paragraph", () => {
    const doc = markdownToProsemirror("[TOC] extra text\n", schema);
    expect(doc.firstChild!.type.name).toBe("paragraph");
  });

  it("[TOC] inside other content stays as paragraph", () => {
    const doc = markdownToProsemirror("before [TOC] after\n", schema);
    expect(doc.firstChild!.type.name).toBe("paragraph");
  });
});

describe("Table of Contents: Schema without TOC", () => {
  const schemaNoToc = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { content: "inline*", group: "block", marks: "_" },
      text: { group: "inline" },
    },
    marks: {},
  });

  it("[TOC] stays as text when schema has no tableOfContents", () => {
    const doc = markdownToProsemirror("[TOC]\n", schemaNoToc);
    expect(doc.firstChild!.type.name).toBe("paragraph");
    expect(doc.firstChild!.textContent).toBe("[TOC]");
  });
});
