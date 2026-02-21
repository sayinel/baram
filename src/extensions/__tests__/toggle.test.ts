// §5.1 Toggle Block Extension — roundtrip + feature tests
import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";

// Schema with toggle node
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
    toggle: {
      content: "paragraph block*",
      group: "block",
      attrs: {
        open: { default: true },
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

describe("Roundtrip: Toggle", () => {
  it("simple toggle with summary and body", () => {
    const input =
      "<details>\n<summary>My Title</summary>\n\nContent paragraph.\n\n</details>\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("toggle with open attribute", () => {
    const input =
      "<details open>\n<summary>Expanded Toggle</summary>\n\nVisible content.\n\n</details>\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("toggle with multi-paragraph body", () => {
    const input =
      "<details>\n<summary>Title</summary>\n\nFirst paragraph.\n\nSecond paragraph.\n\n</details>\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("toggle with summary only (no body)", () => {
    const input =
      "<details>\n<summary>Just a title</summary>\n\n</details>\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("toggle without summary tag", () => {
    const input =
      "<details>\n\nContent without summary.\n\n</details>\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("toggle with list in body", () => {
    const input =
      "<details>\n<summary>List Toggle</summary>\n\n- item 1\n- item 2\n\n</details>\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("toggle with code block in body", () => {
    const input =
      "<details>\n<summary>Code Toggle</summary>\n\n```js\nconst x = 1;\n```\n\n</details>\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("toggle between paragraphs", () => {
    const input =
      "Before.\n\n<details>\n<summary>Title</summary>\n\nBody.\n\n</details>\n\nAfter.\n";
    expect(roundtrip(input)).toBe(input);
  });
});

// ── PM structure tests ──────────────────────────────────────────────

describe("Toggle PM structure", () => {
  it("creates toggle node with open=false for <details>", () => {
    const input =
      "<details>\n<summary>Title</summary>\n\nBody.\n\n</details>\n";
    const doc = markdownToProsemirror(input, schema);
    const toggle = doc.firstChild!;
    expect(toggle.type.name).toBe("toggle");
    expect(toggle.attrs.open).toBe(false);
  });

  it("open=true from <details open>", () => {
    const input =
      "<details open>\n<summary>Title</summary>\n\nBody.\n\n</details>\n";
    const doc = markdownToProsemirror(input, schema);
    const toggle = doc.firstChild!;
    expect(toggle.attrs.open).toBe(true);
  });

  it("first child is summary paragraph", () => {
    const input =
      "<details>\n<summary>My Summary</summary>\n\nBody content.\n\n</details>\n";
    const doc = markdownToProsemirror(input, schema);
    const toggle = doc.firstChild!;
    expect(toggle.childCount).toBe(2);
    expect(toggle.child(0).type.name).toBe("paragraph");
    expect(toggle.child(0).textContent).toBe("My Summary");
    expect(toggle.child(1).type.name).toBe("paragraph");
    expect(toggle.child(1).textContent).toBe("Body content.");
  });

  it("empty summary creates empty paragraph", () => {
    const input = "<details>\n\nContent.\n\n</details>\n";
    const doc = markdownToProsemirror(input, schema);
    const toggle = doc.firstChild!;
    expect(toggle.child(0).type.name).toBe("paragraph");
    expect(toggle.child(0).textContent).toBe("");
  });

  it("summary only toggle has one child", () => {
    const input =
      "<details>\n<summary>Just title</summary>\n\n</details>\n";
    const doc = markdownToProsemirror(input, schema);
    const toggle = doc.firstChild!;
    expect(toggle.childCount).toBe(1);
    expect(toggle.child(0).textContent).toBe("Just title");
  });

  it("multiple body blocks", () => {
    const input =
      "<details>\n<summary>T</summary>\n\nP1.\n\nP2.\n\n</details>\n";
    const doc = markdownToProsemirror(input, schema);
    const toggle = doc.firstChild!;
    expect(toggle.childCount).toBe(3); // summary + 2 paragraphs
  });
});

// ── Nested toggles ──────────────────────────────────────────────────

describe("Nested toggles", () => {
  it("toggle inside toggle roundtrip", () => {
    const input =
      "<details>\n<summary>Outer</summary>\n\n<details>\n<summary>Inner</summary>\n\nInner content.\n\n</details>\n\n</details>\n";
    const doc = markdownToProsemirror(input, schema);
    const outer = doc.firstChild!;
    expect(outer.type.name).toBe("toggle");
    expect(outer.child(0).textContent).toBe("Outer");

    // Find the inner toggle
    let innerToggle: typeof outer | null = null;
    outer.forEach((child) => {
      if (child.type.name === "toggle") innerToggle = child;
    });
    expect(innerToggle).not.toBeNull();
    expect(innerToggle!.child(0).textContent).toBe("Inner");

    // Roundtrip
    expect(roundtrip(input)).toBe(input);
  });
});
