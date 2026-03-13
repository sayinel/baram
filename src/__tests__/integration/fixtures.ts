// Integration test fixtures — reusable markdown samples and schema
import { Schema } from "@tiptap/pm/model";

/** Basic markdown: heading + paragraph + list */
export const FIXTURE_SIMPLE = `# Hello World

This is a paragraph with **bold** and *italic* text.

- Item one
- Item two
- Item three
`;

/** Rich content: math + code + table + frontmatter */
export const FIXTURE_RICH = `---
title: Test Document
tags:
  - test
  - integration
---

# Rich Content

Inline math $E = mc^2$ in a paragraph.

$$
\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}
$$

\`\`\`typescript
const x: number = 42;
console.log(x);
\`\`\`

| Name | Value |
| --- | --- |
| alpha | 1 |
| beta | 2 |
`;

/** 100-line mixed document */
export const FIXTURE_LONG = generateLongFixture();

/** Full M2+M3 schema for integration tests (extracted from roundtrip-m3.test.ts) */
export function createTestSchema(): Schema {
  return new Schema({
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
}

function generateLongFixture(): string {
  const lines: string[] = [];
  lines.push("# Long Document");
  lines.push("");

  for (let i = 1; i <= 20; i++) {
    lines.push(`## Section ${i}`);
    lines.push("");
    lines.push(`Paragraph ${i} with some **bold** text and \`inline code\`.`);
    lines.push("");
  }

  // Add a table
  lines.push("| Col A | Col B |");
  lines.push("| --- | --- |");
  lines.push("| row1 | data1 |");
  lines.push("| row2 | data2 |");
  lines.push("");

  // Add a code block
  lines.push("```javascript");
  lines.push("function hello() {");
  lines.push('  return "world";');
  lines.push("}");
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}
