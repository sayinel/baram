// §8.4 Performance benchmark tests — measure pipeline throughput
import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { markdownToProsemirror } from "../md-to-pm";
import { prosemirrorToMarkdown } from "../pm-to-md";
import { generateMarkdown } from "../../utils/__tests__/perf-helpers";
import katex from "katex";

// CI runners are shared machines — allow 3x headroom
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CI = !!(globalThis as any).process?.env?.CI;
const CI_MULTIPLIER = CI ? 3 : 1;

// Full schema matching M2 + M3 extensions
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
    underline: {},
  },
});

describe("Performance: File Open (MD → ProseMirror)", () => {
  it("opens 1,000-line file within 200ms", () => {
    const md = generateMarkdown(1000);
    const start = performance.now();
    markdownToProsemirror(md, schema);
    const elapsed = performance.now() - start;

    console.log(`[Perf] 1,000-line file open: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(200 * CI_MULTIPLIER);
  });

  it("opens 10,000-line file within 1,000ms", () => {
    const md = generateMarkdown(10000);
    const start = performance.now();
    markdownToProsemirror(md, schema);
    const elapsed = performance.now() - start;

    console.log(`[Perf] 10,000-line file open: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(1000 * CI_MULTIPLIER);
  });
});

describe("Performance: File Save (ProseMirror → MD)", () => {
  it("saves 1,000-line file within 100ms", () => {
    const md = generateMarkdown(1000);
    const doc = markdownToProsemirror(md, schema);

    const start = performance.now();
    prosemirrorToMarkdown(doc);
    const elapsed = performance.now() - start;

    console.log(`[Perf] 1,000-line file save: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(100 * CI_MULTIPLIER);
  });

  it("saves 10,000-line file within 1,000ms", () => {
    const md = generateMarkdown(10000);
    const doc = markdownToProsemirror(md, schema);

    const start = performance.now();
    prosemirrorToMarkdown(doc);
    const elapsed = performance.now() - start;

    console.log(`[Perf] 10,000-line file save: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(1000 * CI_MULTIPLIER);
  });
});

describe("Performance: KaTeX Rendering", () => {
  it("renders complex formula within 50ms", () => {
    const formula =
      "\\int_{-\\infty}^{\\infty} \\frac{1}{\\sigma\\sqrt{2\\pi}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}} dx = 1";

    const start = performance.now();
    katex.renderToString(formula, { displayMode: true, throwOnError: false });
    const elapsed = performance.now() - start;

    console.log(`[Perf] KaTeX complex formula: ${elapsed.toFixed(1)}ms`);
    expect(elapsed).toBeLessThan(50 * CI_MULTIPLIER);
  });
});
