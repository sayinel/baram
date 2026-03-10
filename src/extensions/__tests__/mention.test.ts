import { Schema } from "@tiptap/pm/model";
// §57 Mention — roundtrip + parsing tests
import { describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import {
  MENTION_RE,
  parseMentionMatch,
  serializeMention,
} from "../../pipeline/transformers/mention-transformer";

// Schema with mention + wikilink nodes
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
    // §28 Wikilink node
    wikilink: {
      group: "inline",
      inline: true,
      atom: true,
      marks: "",
      attrs: {
        target: { default: "" },
        display: { default: null },
        heading: { default: null },
        blockId: { default: null },
      },
    },
    // §57 Mention node
    mention: {
      group: "inline",
      inline: true,
      atom: true,
      marks: "",
      attrs: {
        type: { default: "page" },
        value: { default: "" },
      },
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

/** Helper: parse markdown and inspect the PM doc */
function parse(input: string) {
  return markdownToProsemirror(input, schema);
}

/** Helper: roundtrip a markdown string and compare */
function roundtrip(input: string): string {
  const doc = markdownToProsemirror(input, schema);
  return prosemirrorToMarkdown(doc);
}

// --- Utility function tests ---

describe("parseMentionMatch", () => {
  it("parses page mention @[[My Note]]", () => {
    MENTION_RE.lastIndex = 0;
    const m = MENTION_RE.exec("@[[My Note]]")!;
    expect(m).not.toBeNull();
    const result = parseMentionMatch(m);
    expect(result).toEqual({ type: "page", value: "My Note" });
  });

  it("parses date mention @[[2026-02-27]]", () => {
    MENTION_RE.lastIndex = 0;
    const m = MENTION_RE.exec("@[[2026-02-27]]")!;
    expect(m).not.toBeNull();
    const result = parseMentionMatch(m);
    expect(result).toEqual({ type: "date", value: "2026-02-27" });
  });
});

describe("serializeMention", () => {
  it("serializes page mention", () => {
    expect(serializeMention({ type: "page", value: "My Note" })).toBe(
      "@[[My Note]]",
    );
  });

  it("serializes date mention", () => {
    expect(serializeMention({ type: "date", value: "2026-02-27" })).toBe(
      "@[[2026-02-27]]",
    );
  });
});

// --- Roundtrip tests ---

describe("Roundtrip: Mention (§57)", () => {
  it("page mention", () => {
    const input = "Hello @[[My Note]] there\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("date mention", () => {
    const input = "Due @[[2026-02-27]] today\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("standalone mention paragraph", () => {
    const input = "@[[Page]]\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("multiple mentions", () => {
    const input = "@[[A]] and @[[B]]\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("mention + wikilink in same paragraph", () => {
    const input = "@[[Page]] and [[Link]]\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("mention at start of paragraph", () => {
    const input = "@[[Page]] starts the line\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("mention at end of paragraph", () => {
    const input = "Text ending with @[[Page]]\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("mention in heading", () => {
    const input = "# Title with @[[Page]]\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("mention in blockquote", () => {
    const input = "> See @[[Page]] for info\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("mention in list item", () => {
    const input = "- Item with @[[Page]] link\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("mention with bold text", () => {
    const input = "**Bold** and @[[Page]] mention\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("mention not parsed inside code block", () => {
    const input = "```\n@[[not a mention]]\n```\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("mention not parsed inside inline code", () => {
    const input = "Use `@[[not a mention]]` syntax\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("adjacent mentions", () => {
    const input = "@[[Page1]]@[[Page2]]\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("mixed date and page mentions", () => {
    const input = "@[[2026-02-27]] meeting about @[[Project]]\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("wikilink after mention without space", () => {
    const input = "@[[Note]] then [[Wiki]]\n";
    expect(roundtrip(input)).toBe(input);
  });
});

// --- PM document structure tests ---

describe("Mention PM structure", () => {
  it("creates page mention node with correct attrs", () => {
    const doc = parse("Hello @[[Page]] world\n");
    const para = doc.firstChild!;
    expect(para.type.name).toBe("paragraph");

    // Should have: text "Hello ", mention, text " world"
    expect(para.childCount).toBe(3);
    expect(para.child(0).isText).toBe(true);
    expect(para.child(0).text).toBe("Hello ");
    expect(para.child(1).type.name).toBe("mention");
    expect(para.child(1).attrs.type).toBe("page");
    expect(para.child(1).attrs.value).toBe("Page");
    expect(para.child(2).isText).toBe(true);
    expect(para.child(2).text).toBe(" world");
  });

  it("creates date mention node with type=date", () => {
    const doc = parse("@[[2026-02-27]]\n");
    const mention = doc.firstChild!.firstChild!;
    expect(mention.type.name).toBe("mention");
    expect(mention.attrs.type).toBe("date");
    expect(mention.attrs.value).toBe("2026-02-27");
  });

  it("creates multiple mention nodes", () => {
    const doc = parse("@[[A]] and @[[B]]\n");
    const para = doc.firstChild!;
    expect(para.childCount).toBe(3);
    expect(para.child(0).type.name).toBe("mention");
    expect(para.child(0).attrs.value).toBe("A");
    expect(para.child(1).isText).toBe(true);
    expect(para.child(1).text).toBe(" and ");
    expect(para.child(2).type.name).toBe("mention");
    expect(para.child(2).attrs.value).toBe("B");
  });

  it("keeps mention and wikilink as separate node types", () => {
    const doc = parse("@[[Page]] and [[Link]]\n");
    const para = doc.firstChild!;
    expect(para.childCount).toBe(3);
    expect(para.child(0).type.name).toBe("mention");
    expect(para.child(0).attrs.value).toBe("Page");
    expect(para.child(2).type.name).toBe("wikilink");
    expect(para.child(2).attrs.target).toBe("Link");
  });
});
