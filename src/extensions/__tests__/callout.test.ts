// §5.9 Callout Extension — roundtrip + feature tests
import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";

// Schema with callout node
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
    callout: {
      content: "block+",
      group: "block",
      defining: true,
      attrs: {
        type: { default: "info" },
        title: { default: "" },
        collapsed: { default: false },
      },
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

describe("Roundtrip: Callout", () => {
  it("simple callout with title", () => {
    const input = "> [!tip] My Tip\n> This is the body.\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("callout without title", () => {
    const input = "> [!info]\n> Some information.\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("callout with multi-paragraph body", () => {
    const input =
      "> [!warning] Be careful\n> First paragraph.\n>\n> Second paragraph.\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("collapsed callout", () => {
    const input = "> [!tip]- Collapsed title\n> Hidden body.\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("explicit expanded callout (+ suffix dropped, semantically equivalent)", () => {
    const input = "> [!tip]+ Expanded title\n> Visible body.\n";
    // + suffix = default (not collapsed), so roundtrip normalizes to no suffix
    expect(roundtrip(input)).toBe("> [!tip] Expanded title\n> Visible body.\n");
  });

  it("callout type: note", () => {
    const input = "> [!note] A Note\n> Note body.\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("callout type: danger", () => {
    const input = "> [!danger] Danger zone\n> Be very careful.\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("callout type: question", () => {
    const input = "> [!question] FAQ\n> Answer here.\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("regular blockquote is NOT converted to callout", () => {
    const input = "> This is a regular quote\n";
    const doc = markdownToProsemirror(input, schema);
    expect(doc.firstChild!.type.name).toBe("blockquote");
    expect(roundtrip(input)).toBe(input);
  });
});

// ── PM structure tests ──────────────────────────────────────────────

describe("Callout PM structure", () => {
  it("creates callout node with correct attrs", () => {
    const input = "> [!tip] My Tip\n> Body text.\n";
    const doc = markdownToProsemirror(input, schema);
    const callout = doc.firstChild!;
    expect(callout.type.name).toBe("callout");
    expect(callout.attrs.type).toBe("tip");
    expect(callout.attrs.title).toBe("My Tip");
    expect(callout.attrs.collapsed).toBe(false);
  });

  it("collapsed attr from minus suffix", () => {
    const input = "> [!warning]- Title\n> Body.\n";
    const doc = markdownToProsemirror(input, schema);
    const callout = doc.firstChild!;
    expect(callout.attrs.type).toBe("warning");
    expect(callout.attrs.title).toBe("Title");
    expect(callout.attrs.collapsed).toBe(true);
  });

  it("explicit expanded (plus suffix) keeps collapsed=false", () => {
    const input = "> [!info]+ Title\n> Body.\n";
    const doc = markdownToProsemirror(input, schema);
    const callout = doc.firstChild!;
    expect(callout.attrs.collapsed).toBe(false);
  });

  it("body content is block children of callout", () => {
    const input = "> [!tip] Title\n> Paragraph one.\n>\n> Paragraph two.\n";
    const doc = markdownToProsemirror(input, schema);
    const callout = doc.firstChild!;
    expect(callout.childCount).toBe(2);
    expect(callout.child(0).type.name).toBe("paragraph");
    expect(callout.child(1).type.name).toBe("paragraph");
  });

  it("empty title", () => {
    const input = "> [!info]\n> Content.\n";
    const doc = markdownToProsemirror(input, schema);
    const callout = doc.firstChild!;
    expect(callout.attrs.title).toBe("");
    expect(callout.childCount).toBe(1);
  });

  it("callout with nested list", () => {
    const input = "> [!tip] Title\n> - item 1\n> - item 2\n";
    const doc = markdownToProsemirror(input, schema);
    const callout = doc.firstChild!;
    expect(callout.type.name).toBe("callout");
    expect(callout.childCount).toBeGreaterThanOrEqual(1);
  });

  it("callout with code block inside", () => {
    const input = "> [!note] Code Example\n> ```js\n> const x = 1;\n> ```\n";
    const doc = markdownToProsemirror(input, schema);
    const callout = doc.firstChild!;
    expect(callout.type.name).toBe("callout");
  });
});

// ── Block ID inside callout ─────────────────────────────────────────

describe("Callout with block IDs", () => {
  it("body paragraph can have block ID", () => {
    const input = "> [!tip] Title\n> Body text ^myid\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("block ID is on the paragraph, not callout", () => {
    const input = "> [!tip] Title\n> Body text ^bid\n";
    const doc = markdownToProsemirror(input, schema);
    const callout = doc.firstChild!;
    const para = callout.firstChild!;
    expect(para.attrs.blockId).toBe("bid");
  });
});
