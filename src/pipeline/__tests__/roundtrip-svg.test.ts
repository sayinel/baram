import { Schema } from "@tiptap/pm/model";
// §5.1 SVG Block roundtrip tests — ```svg fenced code block ↔ svgBlock node
import { describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../md-to-pm";
import { prosemirrorToMarkdown } from "../pm-to-md";

// Schema with svgBlock node (mirrors the runtime schema slice used by other
// roundtrip tests).
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", marks: "_" },
    heading: {
      content: "inline*",
      group: "block",
      attrs: { level: { default: 1 } },
    },
    codeBlock: {
      content: "text*",
      group: "block",
      marks: "",
      code: true,
      attrs: { language: { default: null } },
    },
    svgBlock: {
      group: "block",
      atom: true,
      attrs: { code: { default: "" } },
    },
    horizontalRule: { group: "block" },
    hardBreak: { inline: true, group: "inline" },
    text: { group: "inline" },
  },
  marks: { bold: {}, italic: {}, code: { excludes: "_" } },
});

function roundtrip(input: string): string {
  const doc = markdownToProsemirror(input, schema);
  return prosemirrorToMarkdown(doc);
}

describe("Roundtrip: SVG Block (§5.1)", () => {
  it("simple svg", () => {
    const input =
      '```svg\n<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>\n```\n';
    expect(roundtrip(input)).toBe(input);
  });

  it("multi-line svg", () => {
    const input =
      '```svg\n<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60">\n  <rect width="120" height="60" fill="#eef"/>\n  <text x="10" y="35">Hello</text>\n</svg>\n```\n';
    expect(roundtrip(input)).toBe(input);
  });

  it("empty svg block", () => {
    const input = "```svg\n```\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("svg block between other blocks", () => {
    const input =
      '# Title\n\n```svg\n<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>\n```\n\nSome text\n';
    expect(roundtrip(input)).toBe(input);
  });

  it("svg vs regular code block coexistence", () => {
    const input =
      '```javascript\nconsole.log("hello");\n```\n\n```svg\n<svg><rect/></svg>\n```\n';
    expect(roundtrip(input)).toBe(input);
  });

  it("preserves a resized width=N% on the root svg (§5.1 resize)", () => {
    const input =
      '```svg\n<svg width="50%" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>\n```\n';
    expect(roundtrip(input)).toBe(input);
  });
});

describe("SVG Block: ProseMirror structure", () => {
  it("creates svgBlock node (not codeBlock) for svg language", () => {
    const input = '```svg\n<svg viewBox="0 0 10 10"><rect/></svg>\n```\n';
    const doc = markdownToProsemirror(input, schema);
    const child = doc.firstChild!;
    expect(child.type.name).toBe("svgBlock");
    expect(child.attrs.code).toBe('<svg viewBox="0 0 10 10"><rect/></svg>');
  });

  it("regular code block remains as codeBlock", () => {
    const input = '```javascript\nconsole.log("hi");\n```\n';
    const doc = markdownToProsemirror(input, schema);
    expect(doc.firstChild!.type.name).toBe("codeBlock");
  });
});
