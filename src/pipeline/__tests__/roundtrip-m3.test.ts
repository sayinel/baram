import { Schema } from "@tiptap/pm/model";
// M3 Roundtrip tests — 수식, 테이블, Frontmatter 변환 정합성 검증
import { describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../md-to-pm";
import { prosemirrorToMarkdown } from "../pm-to-md";

// Build a schema matching M2 + M3 extensions
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
    // M3 nodes
    mathBlock: {
      content: "text*",
      group: "block",
      marks: "",
      code: true,
      attrs: { formula: { default: "" } },
    },
    mathInline: {
      group: "inline",
      inline: true,
      atom: true,
      attrs: { formula: { default: "" } },
    },
    table: { content: "tableRow+", group: "block" },
    tableRow: { content: "(tableCell | tableHeader)+" },
    tableCell: {
      content: "paragraph+",
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        alignment: { default: null },
      },
    },
    tableHeader: {
      content: "paragraph+",
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        alignment: { default: null },
      },
    },
    frontmatter: {
      content: "text*",
      group: "block",
      marks: "",
      code: true,
      attrs: { yaml: { default: "" } },
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
  },
});

/** Helper: roundtrip a markdown string and compare */
function roundtrip(input: string): string {
  const doc = markdownToProsemirror(input, schema);
  return prosemirrorToMarkdown(doc);
}

describe("Roundtrip: Math Block (§5.3)", () => {
  it("simple math block", () => {
    const input = "$$\nE = mc^2\n$$\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("complex math block", () => {
    const input = "$$\n\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\n$$\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("aligned environment", () => {
    const input =
      "$$\n\\begin{aligned}\nx &= 1 \\\\\ny &= 2\n\\end{aligned}\n$$\n";
    expect(roundtrip(input)).toBe(input);
  });
});

describe("Roundtrip: Math Inline (§5.3)", () => {
  it("simple inline math", () => {
    const input = "The formula $E = mc^2$ is famous\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("multiple inline math", () => {
    const input = "Given $x = 1$ and $y = 2$, then $x + y = 3$\n";
    expect(roundtrip(input)).toBe(input);
  });
});

describe("Roundtrip: Tables (§5.5)", () => {
  // Note: remark-gfm normalizes table formatting (column padding, separator width)
  // Tests verify content preservation; formatting is semantically equivalent

  it("simple table — content preserved", () => {
    const input = "| A | B |\n| --- | --- |\n| 1 | 2 |\n";
    const output = roundtrip(input);
    // Content should be preserved even if padding differs
    expect(output).toContain("| A | B |");
    expect(output).toContain("| 1 | 2 |");
    // Should have separator row
    expect(output).toMatch(/\| -+ \| -+ \|/);
  });

  it("simple table — full roundtrip stable", () => {
    const input = "| A | B |\n| --- | --- |\n| 1 | 2 |\n";
    // Second roundtrip should be stable (idempotent)
    const firstPass = roundtrip(input);
    const secondPass = roundtrip(firstPass);
    expect(secondPass).toBe(firstPass);
  });

  it("table with alignment preserved", () => {
    const input =
      "| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |\n";
    const output = roundtrip(input);
    // Alignment markers should be preserved
    expect(output).toMatch(/\| :--+/); // left align
    expect(output).toMatch(/:--+: \|/); // center align
    expect(output).toMatch(/--+: \|/); // right align (at end)
    // Content preserved
    expect(output).toContain("Left");
    expect(output).toContain("Center");
    expect(output).toContain("Right");
  });

  it("table with inline formatting", () => {
    const input = "| **Bold** | *Italic* |\n| --- | --- |\n| `code` | text |\n";
    const output = roundtrip(input);
    expect(output).toContain("**Bold**");
    expect(output).toContain("*Italic*");
    expect(output).toContain("`code`");
    expect(output).toContain("text");
  });

  it("multi-row table", () => {
    const input = [
      "| Name | Value |",
      "| --- | --- |",
      "| A | 1 |",
      "| B | 2 |",
      "| C | 3 |",
      "",
    ].join("\n");
    const output = roundtrip(input);
    expect(output).toContain("Name");
    expect(output).toContain("Value");
    expect(output).toContain("| A");
    expect(output).toContain("| B");
    expect(output).toContain("| C");
    // Stable roundtrip
    expect(roundtrip(output)).toBe(output);
  });
});

describe("Roundtrip: Frontmatter (§5.8)", () => {
  it("simple frontmatter", () => {
    const input = "---\ntitle: Hello\n---\n\nContent here\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("frontmatter with multiple fields", () => {
    const input = [
      "---",
      "title: My Document",
      "tags:",
      "  - tag1",
      "  - tag2",
      "date: 2026-02-14",
      "---",
      "",
      "# Title",
      "",
    ].join("\n");
    expect(roundtrip(input)).toBe(input);
  });
});

describe("Roundtrip: M3 Combined", () => {
  it("document with math and text", () => {
    const input = [
      "# Math Example",
      "",
      "The equation $E = mc^2$ shows mass-energy equivalence.",
      "",
      "$$",
      "\\int_0^\\infty e^{-x} dx = 1",
      "$$",
      "",
    ].join("\n");
    expect(roundtrip(input)).toBe(input);
  });

  it("document with table and math", () => {
    const input = [
      "# Results",
      "",
      "| Variable | Value |",
      "| --- | --- |",
      "| x | 1 |",
      "| y | 2 |",
      "",
      "$$",
      "x + y = 3",
      "$$",
      "",
    ].join("\n");
    const output = roundtrip(input);
    expect(output).toContain("# Results");
    expect(output).toContain("Variable");
    expect(output).toContain("$$\nx + y = 3\n$$");
    // Stable roundtrip
    expect(roundtrip(output)).toBe(output);
  });
});
