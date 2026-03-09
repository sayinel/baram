// §28 Wikilink — roundtrip + parsing tests
import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import {
  parseWikilinkMatch,
  serializeWikilink,
  WIKILINK_RE,
} from "../../pipeline/transformers/wikilink-transformer";

// Schema with wikilink node
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
    frontmatter: {
      content: "text*",
      group: "block",
      marks: "",
      code: true,
      attrs: { yaml: { default: "" } },
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

/** Helper: parse markdown and inspect the PM doc */
function parse(input: string) {
  return markdownToProsemirror(input, schema);
}

// --- Utility function tests ---

describe("parseWikilinkMatch", () => {
  it("parses simple [[page]]", () => {
    WIKILINK_RE.lastIndex = 0;
    const m = WIKILINK_RE.exec("[[my page]]")!;
    expect(m).not.toBeNull();
    const result = parseWikilinkMatch(m);
    expect(result).toEqual({
      target: "my page",
      heading: null,
      blockId: null,
      display: null,
    });
  });

  it("parses [[page|display]]", () => {
    WIKILINK_RE.lastIndex = 0;
    const m = WIKILINK_RE.exec("[[page|Display Text]]")!;
    const result = parseWikilinkMatch(m);
    expect(result).toEqual({
      target: "page",
      heading: null,
      blockId: null,
      display: "Display Text",
    });
  });

  it("parses [[page#heading]]", () => {
    WIKILINK_RE.lastIndex = 0;
    const m = WIKILINK_RE.exec("[[page#Introduction]]")!;
    const result = parseWikilinkMatch(m);
    expect(result).toEqual({
      target: "page",
      heading: "Introduction",
      blockId: null,
      display: null,
    });
  });

  it("parses [[page^blockId]]", () => {
    WIKILINK_RE.lastIndex = 0;
    const m = WIKILINK_RE.exec("[[page^abc123]]")!;
    const result = parseWikilinkMatch(m);
    expect(result).toEqual({
      target: "page",
      heading: null,
      blockId: "abc123",
      display: null,
    });
  });

  it("parses [[page#heading|display]]", () => {
    WIKILINK_RE.lastIndex = 0;
    const m = WIKILINK_RE.exec("[[page#Intro|Introduction]]")!;
    const result = parseWikilinkMatch(m);
    expect(result).toEqual({
      target: "page",
      heading: "Intro",
      blockId: null,
      display: "Introduction",
    });
  });
});

describe("serializeWikilink", () => {
  it("serializes simple target", () => {
    expect(serializeWikilink({ target: "page" })).toBe("[[page]]");
  });

  it("serializes target with display", () => {
    expect(
      serializeWikilink({ target: "page", display: "My Page" }),
    ).toBe("[[page|My Page]]");
  });

  it("serializes target with heading", () => {
    expect(
      serializeWikilink({ target: "page", heading: "Intro" }),
    ).toBe("[[page#Intro]]");
  });

  it("serializes target with blockId", () => {
    expect(
      serializeWikilink({ target: "page", blockId: "abc123" }),
    ).toBe("[[page^abc123]]");
  });

  it("serializes target with heading and display", () => {
    expect(
      serializeWikilink({
        target: "page",
        heading: "Intro",
        display: "Introduction",
      }),
    ).toBe("[[page#Intro|Introduction]]");
  });
});

// --- Roundtrip tests ---

describe("Roundtrip: Wikilink (§28)", () => {
  it("simple wikilink", () => {
    const input = "See [[my page]] for details\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("wikilink with display text", () => {
    const input = "Check [[architecture|아키텍처]] docs\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("wikilink with heading anchor", () => {
    const input = "Read [[design#3.1 기술 스택]] section\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("wikilink with block ID", () => {
    const input = "Reference [[notes^abc123]] block\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("wikilink with heading and display", () => {
    const input = "See [[design#Intro|Introduction]] here\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("standalone wikilink paragraph", () => {
    const input = "[[page]]\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("multiple wikilinks in one paragraph", () => {
    const input = "Link [[page1]] and [[page2]] here\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("wikilink at start of paragraph", () => {
    const input = "[[page]] starts the line\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("wikilink at end of paragraph", () => {
    const input = "Text ending with [[page]]\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("wikilink with bold in same paragraph", () => {
    const input = "**Bold text** and [[page]] link\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("wikilink in heading", () => {
    const input = "# Title with [[page]]\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("wikilink in blockquote", () => {
    const input = "> See [[page]] for info\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("wikilink in list item", () => {
    const input = "- Item with [[page]] link\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("wikilink not parsed inside code block", () => {
    const input = "```\n[[not a link]]\n```\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("wikilink not parsed inside inline code", () => {
    const input = "Use `[[not a link]]` syntax\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("adjacent wikilinks", () => {
    const input = "[[page1]][[page2]]\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("wikilink with spaces in target", () => {
    const input = "See [[my long page name]] here\n";
    expect(roundtrip(input)).toBe(input);
  });
});

// --- §61 Namespace: Roundtrip tests for relative wikilinks ---

describe("Roundtrip: §61 Namespace (relative wikilinks)", () => {
  it("same-directory [[./file]]", () => {
    const input = "See [[./prompt]] for details\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("parent-directory [[../file]]", () => {
    const input = "See [[../meeting-notes]] for details\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("subdirectory [[./sub/file]]", () => {
    const input = "See [[./ai/prompt]] for details\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("multi-level parent [[../../file]]", () => {
    const input = "See [[../../readme]] for details\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("relative link with display text", () => {
    const input = "See [[./prompt|My Prompt]] for details\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("relative link with heading anchor", () => {
    const input = "See [[./prompt#Introduction]] for details\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("relative link with heading and display", () => {
    const input = "See [[./prompt#Intro|Introduction]] for details\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("standalone relative wikilink", () => {
    const input = "[[./sibling]]\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("multiple relative wikilinks in one paragraph", () => {
    const input = "Link [[./file1]] and [[../file2]] here\n";
    expect(roundtrip(input)).toBe(input);
  });
});

// --- PM document structure tests ---

describe("Wikilink PM structure", () => {
  it("creates wikilink node with correct attrs", () => {
    const doc = parse("Hello [[page]] world\n");
    const para = doc.firstChild!;
    expect(para.type.name).toBe("paragraph");

    // Should have: text "Hello ", wikilink, text " world"
    expect(para.childCount).toBe(3);
    expect(para.child(0).isText).toBe(true);
    expect(para.child(0).text).toBe("Hello ");
    expect(para.child(1).type.name).toBe("wikilink");
    expect(para.child(1).attrs.target).toBe("page");
    expect(para.child(2).isText).toBe(true);
    expect(para.child(2).text).toBe(" world");
  });

  it("creates wikilink with display attr", () => {
    const doc = parse("[[page|My Page]]\n");
    const wl = doc.firstChild!.firstChild!;
    expect(wl.type.name).toBe("wikilink");
    expect(wl.attrs.target).toBe("page");
    expect(wl.attrs.display).toBe("My Page");
  });

  it("creates wikilink with heading attr", () => {
    const doc = parse("[[page#Section]]\n");
    const wl = doc.firstChild!.firstChild!;
    expect(wl.type.name).toBe("wikilink");
    expect(wl.attrs.target).toBe("page");
    expect(wl.attrs.heading).toBe("Section");
  });

  it("creates multiple wikilink nodes", () => {
    const doc = parse("[[a]] and [[b]]\n");
    const para = doc.firstChild!;
    expect(para.childCount).toBe(3);
    expect(para.child(0).type.name).toBe("wikilink");
    expect(para.child(0).attrs.target).toBe("a");
    expect(para.child(1).isText).toBe(true);
    expect(para.child(1).text).toBe(" and ");
    expect(para.child(2).type.name).toBe("wikilink");
    expect(para.child(2).attrs.target).toBe("b");
  });
});
