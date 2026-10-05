// §388 spec 0067 §6 · §11-2 ~ §11-4 — the text-level insertion rules: where inline and block
// results may go in a textblock, code literals, and the table-cell and split refusals.
import type { Editor } from "@tiptap/core";

import { getSchema } from "@tiptap/core";
import { Slice } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { describe, expect, it, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { serializeLiveDoc } from "../../utils/editor/serialize-live-doc";
import { BLOCK_REFUSING_PARENTS, buildInsertion } from "../editor-insert-rules";
import { EditorRefusalError } from "../editor-refusal";
import { at, insert, refused, topTypes } from "./insert-fixtures";
import { codeOf, realEditor } from "./real-editor";

const CELL = "| a | b |\n| --- | --- |\n| c @@ | d |\n";

/** Position of the first text node whose text is `text` and that carries mark `mark`. */
function textWithMark(editor: Editor, mark: string, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (
      found === -1 &&
      node.isText &&
      node.text === text &&
      node.marks.some((m) => m.type.name === mark)
    ) {
      found = pos;
    }
  });
  if (found === -1) throw new Error(`no ${mark} text ${text}`);
  return found;
}

/** Mark names on the text node whose text is exactly `text`. */
function marksOfText(editor: Editor, text: string): string[] {
  let marks: null | string[] = null;
  editor.state.doc.descendants((node) => {
    if (marks === null && node.isText && node.text === text) {
      marks = node.marks.map((m) => m.type.name);
    }
  });
  if (marks === null) throw new Error(`no text node ${text}`);
  return marks;
}

/** Caret at the document's first position, with bold stored (user toggled bold there). */
function storeBoldAtStart(editor: Editor): void {
  const tr = editor.state.tr.setSelection(
    TextSelection.create(editor.state.doc, 1),
  );
  tr.addStoredMark(editor.schema.marks.bold.create());
  editor.view.dispatch(tr);
}

describe("insertion rules (spec 0067 §6)", () => {
  // §6.1 rows, measured at 163b9e62.

  it("inline into a paragraph keeps the link", () => {
    expect(at("alpha @@ omega\n", "[Title](https://example.com)")).toBe(
      "alpha [Title](https://example.com) omega\n",
    );
  });

  it("blocks into the middle of a paragraph split it and stay blocks", () => {
    expect(at("alpha @@ omega\n", "## H\n\n- a\n- b")).toBe(
      "alpha\n\n## H\n\n- a\n- b\n\n&#x20;omega\n",
    );
  });

  it("two paragraphs merge into the edges", () => {
    expect(at("alpha @@ omega\n", "p1\n\np2")).toBe("alpha p1\n\np2 omega\n");
  });

  it("two paragraphs inside a list item stay in the item", () => {
    expect(at("- one @@ two\n- three\n", "para1\n\npara2")).toBe(
      "- one para1\n\n  para2 two\n- three\n",
    );
  });

  it("inline into a table cell", () => {
    expect(at("| a | b |\n| --- | --- |\n| c @@ | d |\n", "**z**")).toBe(
      "| a | b |\n| - | - |\n| c **z** | d |\n",
    );
  });

  it("refuses blocks in a table cell — two paragraphs and a heading (rule 5a)", () => {
    refused("| a | b |\n| --- | --- |\n| c @@ | d |\n", "p1\n\np2");
    refused("| a | b |\n| --- | --- |\n| c @@ | d |\n", "## H");
  });

  it("refuses front matter that is not at the document start (rule 5b)", () => {
    refused("alpha @@ omega\n", "---\ntitle: x\n---\n\nbody");
  });

  it("two paragraphs inside a quote stay in the quote", () => {
    expect(at("> quote @@ end\n", "x\n\ny")).toBe("> quote x\n>\n> y end\n");
  });

  // §6.2 rules.

  it("a heading takes inline content but not blocks (rule 3 · 4)", () => {
    expect(at("# Hea@@ding\n", "**b**")).toBe("# Hea**b**ding\n");
    refused("# Hea@@ding\n", "p1\n\np2");
    refused("# Hea@@ding\n", "## H");
  });

  it("a range from a paragraph into a heading refuses both inline and blocks (rule 3 · 4)", () => {
    refused("para A@@ rest\n\n## Hea@@ding\n", "x");
    refused("para A@@ rest\n\n## Hea@@ding\n", "p1\n\np2");
  });

  it("a range across two paragraphs joins them (positive)", () => {
    expect(at("para A@@ rest\n\npara B@@ tail\n", "x")).toBe("para Ax tail\n");
  });

  it("inside a code block the markdown goes in literally (rule 2)", () => {
    expect(at("```\nco@@de\n```\n", "**x**")).toBe("```\nco**x**de\n```\n");
  });

  it("refuses a range that crosses a code block's edge (rule 2)", () => {
    refused("before @@ here\n\n```\nco@@de\n```\n", "x");
  });

  it("blocks into an empty paragraph replace it — no empty line left (rule 4)", () => {
    const { editor, from, to } = realEditor("alpha\n\n@@\n\nomega\n");
    insert(editor, { from, kind: "text", to }, "## H\n\n- a");
    expect(topTypes(editor)).toEqual([
      "paragraph",
      "heading",
      "bulletList",
      "paragraph",
    ]);
    editor.destroy();
  });

  it("blocks over a paragraph's whole content replace it; part of it splits it (rule 4)", () => {
    const whole = realEditor("alpha\n\n@@mid@@\n\nomega\n");
    insert(
      whole.editor,
      { from: whole.from, kind: "text", to: whole.to },
      "## H\n\n- a",
    );
    expect(topTypes(whole.editor)).toEqual([
      "paragraph",
      "heading",
      "bulletList",
      "paragraph",
    ]);
    whole.editor.destroy();
    const part = realEditor("alpha\n\nm@@i@@d\n\nomega\n");
    insert(
      part.editor,
      { from: part.from, kind: "text", to: part.to },
      "## H\n\n- a",
    );
    expect(topTypes(part.editor)).toEqual([
      "paragraph",
      "paragraph",
      "heading",
      "bulletList",
      "paragraph",
      "paragraph",
    ]);
    part.editor.destroy();
  });

  it("an empty list item gets its required first paragraph back (rule 4, 1st review probe)", () => {
    const { editor, from, to } = realEditor("- @@\n");
    insert(editor, { from, kind: "text", to }, "- a\n- b");
    const item = editor.state.doc.firstChild!.firstChild!;
    expect(item.type.name).toBe("listItem");
    expect(item.firstChild!.type.name).toBe("paragraph");
    expect(item.firstChild!.content.size).toBe(0);
    expect(item.child(1).type.name).toBe("bulletList");
    expect(item.child(1).childCount).toBe(2);
    editor.destroy();
  });

  it("inside inline code the markdown goes in literally and stays code (2026-10-04 decision)", () => {
    // No marker: a caret inside the span would make the reveal expand it. "a " 1-3, code 3-7.
    const { editor } = realEditor("a `code` b\n");
    insert(editor, { from: 5, kind: "text", to: 5 }, "**x**");
    expect(serializeLiveDoc(editor)).toBe("a `co**x**de` b\n");
    editor.destroy();
  });

  // I3 · §11-3 rows.
  it("a block result into an empty heading is refused (rule 3)", () => {
    refused("# @@\n", "p1\n\np2");
    refused("# @@\n", "## H");
  });

  it("a range across two different code blocks is refused; inside one it inserts literally", () => {
    const two = "```\nco@@de\n```\n\n```\nbl@@ock\n```\n";
    refused(two, "x");
    expect(at("```\nco@@d@@e\n```\n", "**x**")).toBe("```\nco**x**e\n```\n");
  });

  it("inside front matter the markdown goes in literally (rule 2)", () => {
    const { editor, from, to } = realEditor("---\nt: @@1\n---\n\nbody\n");
    insert(editor, { from, kind: "text", to }, "**x**");
    expect(editor.state.doc.firstChild!.type.name).toBe("frontmatter");
    expect(editor.state.doc.firstChild!.textContent).toBe("t: **x**1");
    editor.destroy();
  });

  // I4 · the literal paths ignore stored marks.
  it("literal markdown in inline code stays code even when bold is stored elsewhere", () => {
    const { editor } = realEditor("alpha\n\na `code` b\n");
    const code = textWithMark(editor, "code", "code");
    storeBoldAtStart(editor);
    expect(editor.state.storedMarks?.some((m) => m.type.name === "bold")).toBe(
      true,
    ); // the mechanism is armed
    insert(editor, { from: code + 2, kind: "text", to: code + 2 }, "**x**");
    const marks = marksOfText(editor, "co**x**de");
    expect(marks).toEqual(["code"]);
    editor.destroy();
  });

  it("kind text takes the marks at the target, not the stored ones", () => {
    const { editor } = realEditor("alpha\n\nomega\n");
    storeBoldAtStart(editor);
    expect(editor.state.storedMarks?.some((m) => m.type.name === "bold")).toBe(
      true,
    );
    const at2 = editor.state.doc.content.size - 1;
    editor.view.dispatch(
      buildInsertion(
        editor.state,
        { from: at2, kind: "text", to: at2 },
        { kind: "text", text: "X" },
        "insertText",
      ),
    );
    expect(marksOfText(editor, "omegaX")).toEqual([]);
    editor.destroy();
  });

  // M5 · the kind text input.
  it("kind text lands as plain text and is not parsed", () => {
    const { editor, from, to } = realEditor("alpha @@ omega\n");
    editor.view.dispatch(
      buildInsertion(
        editor.state,
        { from, kind: "text", to },
        { kind: "text", text: "**x** # y" },
        "insertText",
      ),
    );
    expect(topTypes(editor)).toEqual(["paragraph"]);
    expect(editor.state.doc.textContent).toBe("alpha **x** # y omega");
    expect(marksOfText(editor, "alpha **x** # y omega")).toEqual([]);
    editor.destroy();
  });

  it("rule 5c refuses a split above the textblock (the skipCellRule option silences 5a)", () => {
    // `{ skipCellRule: true }` is what silences rule 5a here: the target `| c @@ |` IS a cell
    // paragraph, so without the option 5a would refuse first and this row would pass without
    // 5(c) ever running. With it, a heading into the cell reaches `checkedReplace`, and 5(c) is
    // what stops the table split (measured shape: §6.1 row "## H → 표 셀"). The next row
    // shows that the same replacement, done directly, really does split the table.
    const { editor, from, to } = realEditor(CELL);
    const fragment = markdownToProsemirror("## H", editor.schema).content;
    const before = editor.state.doc;
    expect(
      codeOf(() =>
        buildInsertion(
          editor.state,
          { from, kind: "text", to },
          { fragment, kind: "markdown", source: "## H" },
          "insertMarkdown",
          { skipCellRule: true },
        ),
      ),
    ).toBe("cannot-insert-here");
    expect(editor.state.doc).toBe(before);
    editor.destroy();
  });

  it("without rule 5c the closed-slice replace splits the table (guards the 5c row)", () => {
    const { editor, from, to } = realEditor(CELL);
    const fragment = markdownToProsemirror("## H", editor.schema).content;
    const depth = editor.state.doc.resolve(from).sharedDepth(to);
    const tr = editor.state.tr.replace(from, to, new Slice(fragment, 0, 0));
    const start = tr.mapping.map(from, -1);
    const end = tr.mapping.map(to, 1);
    // The ends no longer share the cell paragraph's ancestors: the table was cut open.
    expect(tr.doc.resolve(start).sharedDepth(end)).toBeLessThan(depth - 1);
    // Positive pair: a plain inline insert at the same place keeps the ends together.
    const inline = editor.state.tr.insertText("z", from, to);
    expect(
      inline.doc
        .resolve(inline.mapping.map(from, -1))
        .sharedDepth(inline.mapping.map(to, 1)),
    ).toBeGreaterThanOrEqual(depth - 1);
    editor.destroy();
  });

  it("the 5a corpus is the eight multi-paragraph containers, and cells stay paragraph+", () => {
    const schema = getSchema(createBaramExtensions());
    const p = schema.nodes.paragraph;
    const multi = Object.values(schema.nodes)
      .filter((n) => n.name !== "doc" && !n.isTextblock && !n.isLeaf)
      .filter((n) => n.contentMatch.matchType(p)?.matchType(p))
      .map((n) => n.name)
      .sort();
    expect(multi).toEqual([
      "blockquote",
      "callout",
      "footnoteDefinition",
      "listItem",
      "tableCell",
      "tableHeader",
      "taskItem",
      "toggle",
    ]);
    expect(schema.nodes.tableCell.spec.content).toBe("paragraph+");
    expect(schema.nodes.tableHeader.spec.content).toBe("paragraph+");
    expect([...BLOCK_REFUSING_PARENTS].sort()).toEqual([
      "tableCell",
      "tableHeader",
    ]);
  });

  it("an error is an EditorRefusalError", () => {
    const { editor, from, to } = realEditor("# Hea@@ding\n");
    let caught: unknown = null;
    try {
      insert(editor, { from, kind: "text", to }, "p1\n\np2");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EditorRefusalError);
    editor.destroy();
  });
});
