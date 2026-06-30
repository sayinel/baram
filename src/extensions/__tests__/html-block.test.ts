import { Schema } from "@tiptap/pm/model";
// §5.1 HTML Block Extension — roundtrip + feature tests
import { describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";

// Schema with htmlBlock node + toggle + image for preservation tests
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
    htmlBlock: {
      group: "block",
      atom: true,
      attrs: { content: { default: "" } },
    },
    toggle: {
      content: "(paragraph | heading) block*",
      group: "block",
      attrs: { open: { default: true } },
    },
    image: {
      group: "block",
      atom: true,
      attrs: {
        src: { default: null },
        alt: { default: null },
        title: { default: null },
        widthPercent: { default: 100 },
      },
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

describe("Roundtrip: HTML Block", () => {
  it("div with centered image", () => {
    const input =
      '<div align="center"><img src="test.png" width="600"></div>\n';
    expect(roundtrip(input)).toBe(input);
  });

  it("div with paragraph", () => {
    const input = "<div><p>hello</p></div>\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("table HTML", () => {
    const input = "<table><tr><td>cell</td></tr></table>\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("html block between paragraphs", () => {
    const input = 'Before.\n\n<div align="center">content</div>\n\nAfter.\n';
    expect(roundtrip(input)).toBe(input);
  });

  it("multiple html blocks", () => {
    const input = "<div>first</div>\n\n<div>second</div>\n";
    expect(roundtrip(input)).toBe(input);
  });
});

// ── Preservation of existing behavior ───────────────────────────────

describe("HTML Block does not capture special HTML", () => {
  it("<details> should become toggle, not htmlBlock", () => {
    const input =
      "<details>\n<summary>My Title</summary>\n\nContent paragraph.\n\n</details>\n";
    const doc = markdownToProsemirror(input, schema);
    const firstChild = doc.firstChild!;
    expect(firstChild.type.name).toBe("toggle");
  });

  it("<img> standalone should become image, not htmlBlock", () => {
    const input = '<img src="test.png" width="200" />\n';
    const doc = markdownToProsemirror(input, schema);
    const firstChild = doc.firstChild!;
    expect(firstChild.type.name).toBe("image");
  });
});

// ── Inline SVG (§5.1 Option A) ──────────────────────────────────────

describe("HTML Block: raw SVG markup", () => {
  // CommonMark HTML-block rule: the opening tag must be alone on its line for
  // the block to be captured as raw HTML (a single-line `<svg>…</svg>` with
  // content after the tag is parsed as a paragraph instead). This multi-line
  // form is the supported way to author inline SVG; the ```svg fenced block
  // (svgBlock) is the robust path for arbitrary SVG source.
  it("block-level multi-line <svg> becomes an htmlBlock and roundtrips", () => {
    const input =
      '<svg viewBox="0 0 100 100">\n  <circle cx="50" cy="50" r="40"/>\n</svg>\n';
    const doc = markdownToProsemirror(input, schema);
    const block = doc.firstChild!;
    expect(block.type.name).toBe("htmlBlock");
    expect(block.attrs.content).toBe(
      '<svg viewBox="0 0 100 100">\n  <circle cx="50" cy="50" r="40"/>\n</svg>',
    );
    expect(roundtrip(input)).toBe(input);
  });
});

// ── PM structure tests ──────────────────────────────────────────────

describe("HTML Block PM structure", () => {
  it("creates htmlBlock node with content attribute", () => {
    const input = "<div>hello world</div>\n";
    const doc = markdownToProsemirror(input, schema);
    const block = doc.firstChild!;
    expect(block.type.name).toBe("htmlBlock");
    expect(block.attrs.content).toBe("<div>hello world</div>");
  });

  it("preserves full HTML including attributes", () => {
    const input =
      '<div align="center" class="hero"><img src="logo.png" alt="Logo"></div>\n';
    const doc = markdownToProsemirror(input, schema);
    const block = doc.firstChild!;
    expect(block.type.name).toBe("htmlBlock");
    expect(block.attrs.content).toBe(
      '<div align="center" class="hero"><img src="logo.png" alt="Logo"></div>',
    );
  });
});
