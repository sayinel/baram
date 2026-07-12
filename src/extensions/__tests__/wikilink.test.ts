import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { Schema } from "@tiptap/pm/model";
// §28 Wikilink — roundtrip + parsing tests
import { beforeEach, describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import {
  parseWikilinkMatch,
  serializeWikilink,
  WIKILINK_RE,
} from "../../pipeline/transformers/wikilink-transformer";
import { useZettelIndexStore } from "../../stores/zettelkasten/zettel-index";
import { Paragraph } from "../nodes/paragraph";
import { Wikilink } from "../nodes/wikilink";

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
        vaultAlias: { default: null },
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

describe("parseWikilinkMatch", () => {
  it("parses simple [[page]]", () => {
    WIKILINK_RE.lastIndex = 0;
    const m = WIKILINK_RE.exec("[[my page]]")!;
    expect(m).not.toBeNull();
    const result = parseWikilinkMatch(m);
    expect(result).toEqual({
      vaultAlias: null,
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
      vaultAlias: null,
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
      vaultAlias: null,
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
      vaultAlias: null,
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
      vaultAlias: null,
      target: "page",
      heading: "Intro",
      blockId: null,
      display: "Introduction",
    });
  });

  // §87 Cross-vault alias parsing
  it("parses [[alias::target]]", () => {
    WIKILINK_RE.lastIndex = 0;
    const m = WIKILINK_RE.exec("[[journal::2026-03-22]]")!;
    expect(m).not.toBeNull();
    const result = parseWikilinkMatch(m);
    expect(result).toEqual({
      vaultAlias: "journal",
      target: "2026-03-22",
      heading: null,
      blockId: null,
      display: null,
    });
  });

  it("parses [[alias::target#heading|display]]", () => {
    WIKILINK_RE.lastIndex = 0;
    const m = WIKILINK_RE.exec("[[work::doc#intro|Introduction]]")!;
    const result = parseWikilinkMatch(m);
    expect(result).toEqual({
      vaultAlias: "work",
      target: "doc",
      heading: "intro",
      blockId: null,
      display: "Introduction",
    });
  });

  it("parses [[alias::target^blockId]]", () => {
    WIKILINK_RE.lastIndex = 0;
    const m = WIKILINK_RE.exec("[[work::file^abc123]]")!;
    const result = parseWikilinkMatch(m);
    expect(result).toEqual({
      vaultAlias: "work",
      target: "file",
      heading: null,
      blockId: "abc123",
      display: null,
    });
  });
});

describe("serializeWikilink", () => {
  it("serializes simple target", () => {
    expect(serializeWikilink({ target: "page" })).toBe("[[page]]");
  });

  it("serializes target with display", () => {
    expect(serializeWikilink({ target: "page", display: "My Page" })).toBe(
      "[[page|My Page]]",
    );
  });

  it("serializes target with heading", () => {
    expect(serializeWikilink({ target: "page", heading: "Intro" })).toBe(
      "[[page#Intro]]",
    );
  });

  it("serializes target with blockId", () => {
    expect(serializeWikilink({ target: "page", blockId: "abc123" })).toBe(
      "[[page^abc123]]",
    );
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

  // §87 Cross-vault alias serialization
  it("serializes cross-vault alias", () => {
    expect(
      serializeWikilink({ target: "2026-03-22", vaultAlias: "journal" }),
    ).toBe("[[journal::2026-03-22]]");
  });

  it("serializes cross-vault with heading and display", () => {
    expect(
      serializeWikilink({
        target: "doc",
        vaultAlias: "work",
        heading: "intro",
        display: "Introduction",
      }),
    ).toBe("[[work::doc#intro|Introduction]]");
  });

  it("serializes cross-vault with blockId", () => {
    expect(
      serializeWikilink({
        target: "file",
        vaultAlias: "work",
        blockId: "abc123",
      }),
    ).toBe("[[work::file^abc123]]");
  });
});

// --- §87 Cross-vault roundtrip: parse + serialize ---

describe("Cross-vault [[alias::target]] roundtrip (§87)", () => {
  it.each([
    ["basic cross-vault", "[[journal::2026-03-22]]"],
    ["cross-vault with path", "[[work::skills/analyzer]]"],
    ["cross-vault with heading", "[[work::file#section]]"],
    ["cross-vault with display", "[[journal::note|My Note]]"],
    [
      "cross-vault with heading and display",
      "[[work::doc#intro|Introduction]]",
    ],
    ["cross-vault with blockId", "[[work::file^abc123]]"],
    ["regular wikilink unchanged", "[[normal-link]]"],
    ["regular with display", "[[page|Display Text]]"],
    ["regular with heading", "[[page#Section]]"],
    ["hyphenated alias", "[[my-vault::page]]"],
  ])("roundtrip: %s", (_, input) => {
    WIKILINK_RE.lastIndex = 0;
    const match = WIKILINK_RE.exec(input);
    expect(match).not.toBeNull();
    const attrs = parseWikilinkMatch(match!);
    const output = serializeWikilink(attrs);
    expect(output).toBe(input);
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

// --- §87 Cross-vault: Full pipeline roundtrip tests ---

describe("Roundtrip: Cross-vault wikilink (§87)", () => {
  it("basic cross-vault link", () => {
    const input = "See [[journal::2026-03-22]] for details\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("cross-vault with path", () => {
    const input = "Check [[work::skills/analyzer]] here\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("cross-vault with heading", () => {
    const input = "Read [[work::file#section]] section\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("cross-vault with display text", () => {
    const input = "See [[journal::note|My Note]] here\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("cross-vault with heading and display", () => {
    const input = "Read [[work::doc#intro|Introduction]] here\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("cross-vault with blockId", () => {
    const input = "Reference [[work::file^abc123]] block\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("cross-vault mixed with regular wikilinks", () => {
    const input = "Link [[journal::note]] and [[regular-page]] here\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("cross-vault in heading", () => {
    const input = "# Title with [[work::doc]]\n";
    expect(roundtrip(input)).toBe(input);
  });

  it("cross-vault in list item", () => {
    const input = "- Item with [[journal::2026-03-22]] link\n";
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

  // §87 Cross-vault PM structure
  it("creates cross-vault wikilink with vaultAlias attr", () => {
    const doc = parse("Link [[journal::2026-03-22]] here\n");
    const para = doc.firstChild!;
    expect(para.childCount).toBe(3);
    const wl = para.child(1);
    expect(wl.type.name).toBe("wikilink");
    expect(wl.attrs.vaultAlias).toBe("journal");
    expect(wl.attrs.target).toBe("2026-03-22");
  });

  it("creates cross-vault wikilink with all attrs", () => {
    const doc = parse("[[work::doc#intro|Introduction]]\n");
    const wl = doc.firstChild!.firstChild!;
    expect(wl.type.name).toBe("wikilink");
    expect(wl.attrs.vaultAlias).toBe("work");
    expect(wl.attrs.target).toBe("doc");
    expect(wl.attrs.heading).toBe("intro");
    expect(wl.attrs.display).toBe("Introduction");
  });

  it("regular wikilink has null vaultAlias", () => {
    const doc = parse("[[page]]\n");
    const wl = doc.firstChild!.firstChild!;
    expect(wl.attrs.vaultAlias).toBeNull();
  });
});

// --- §95 B2 eager normalization: manually-typed [[title]] → [[id]] ---

describe("InputRule: B2 eager normalization (§95)", () => {
  function createWikilinkEditor(): Editor {
    return new Editor({
      extensions: [Document, Paragraph, Text, Wikilink],
      content: "<p></p>",
    });
  }

  /**
   * Simulates the user finishing typing `[[...]]` by hand (no autocomplete
   * popup): the literal text is inserted into the doc, then the
   * InputRule plugin's `handleTextInput` prop is invoked directly — the
   * same prop ProseMirror's DOM input handling calls on a real keystroke —
   * so the Wikilink InputRule handler actually runs.
   */
  function typeWikilink(editor: Editor, text: string): void {
    const insertPos = editor.state.doc.content.size - 1;
    editor.commands.insertContentAt(insertPos, text);
    const endPos = editor.state.doc.content.size - 1;
    editor.view.someProp("handleTextInput", (f) =>
      f(editor.view, endPos, endPos, "", () => editor.state.tr),
    );
  }

  beforeEach(() => {
    useZettelIndexStore.getState().clear();
  });

  it("rewrites target to id on unique title match", () => {
    useZettelIndexStore
      .getState()
      .setAll([
        { id: "202607051530", path: "notes/atom.md", title: "원자적 노트" },
      ]);
    const editor = createWikilinkEditor();
    typeWikilink(editor, "[[원자적 노트]]");
    const wl = editor.state.doc.firstChild!.firstChild!;
    expect(wl.type.name).toBe("wikilink");
    expect(wl.attrs.target).toBe("202607051530");
    editor.destroy();
  });

  it("keeps typed title unchanged when the zettel index is empty", () => {
    const editor = createWikilinkEditor();
    typeWikilink(editor, "[[원자적 노트]]");
    const wl = editor.state.doc.firstChild!.firstChild!;
    expect(wl.type.name).toBe("wikilink");
    expect(wl.attrs.target).toBe("원자적 노트");
    editor.destroy();
  });

  it("keeps typed title unchanged when the title is ambiguous (2+ notes share it)", () => {
    useZettelIndexStore.getState().setAll([
      { id: "202607051530", path: "notes/a.md", title: "원자적 노트" },
      { id: "202607051531", path: "notes/b.md", title: "원자적 노트" },
    ]);
    const editor = createWikilinkEditor();
    typeWikilink(editor, "[[원자적 노트]]");
    const wl = editor.state.doc.firstChild!.firstChild!;
    expect(wl.type.name).toBe("wikilink");
    expect(wl.attrs.target).toBe("원자적 노트");
    editor.destroy();
  });

  it("does not rewrite a target that is already a zettel id", () => {
    useZettelIndexStore
      .getState()
      .setAll([
        { id: "202607051530", path: "notes/atom.md", title: "202607051530" },
      ]);
    const editor = createWikilinkEditor();
    typeWikilink(editor, "[[202607051530]]");
    const wl = editor.state.doc.firstChild!.firstChild!;
    expect(wl.type.name).toBe("wikilink");
    expect(wl.attrs.target).toBe("202607051530");
    editor.destroy();
  });

  it("does not rewrite a cross-vault target even on unique title match", () => {
    useZettelIndexStore
      .getState()
      .setAll([
        { id: "202607051530", path: "notes/atom.md", title: "2026-03-22" },
      ]);
    const editor = createWikilinkEditor();
    typeWikilink(editor, "[[journal::2026-03-22]]");
    const wl = editor.state.doc.firstChild!.firstChild!;
    expect(wl.type.name).toBe("wikilink");
    expect(wl.attrs.vaultAlias).toBe("journal");
    expect(wl.attrs.target).toBe("2026-03-22");
    editor.destroy();
  });
});
