// §388 spec 0067 §6 · §11-2 ~ §11-4 — the insertion rules, without anchors or dispatch policy.
import type { Editor } from "@tiptap/core";

import { getSchema } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import { describe, expect, it, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import type { InsertTarget } from "../editor-insert-rules";

import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { serializeLiveDoc } from "../../utils/editor/serialize-live-doc";
import { BLOCK_REFUSING_PARENTS, buildInsertion } from "../editor-insert-rules";
import { EditorRefusalError } from "../editor-refusal";
import { codeOf, realEditor } from "./real-editor";

function at(source: string, markdown: string): string {
  const { editor, from, to } = realEditor(source);
  insert(editor, { from, kind: "text", to }, markdown);
  const out = serializeLiveDoc(editor);
  editor.destroy();
  return out;
}

function insert(editor: Editor, target: InsertTarget, markdown: string): void {
  const fragment = markdownToProsemirror(markdown, editor.schema).content;
  editor.view.dispatch(
    buildInsertion(
      editor.state,
      target,
      { fragment, kind: "markdown", source: markdown },
      "insertMarkdown",
    ),
  );
}

function refused(source: string, markdown: string): void {
  const { editor, from, to } = realEditor(source);
  const before = editor.state.doc;
  expect(
    codeOf(() => insert(editor, { from, kind: "text", to }, markdown)),
  ).toBe("cannot-insert-here");
  expect(editor.state.doc).toBe(before); // nothing dispatched
  editor.destroy();
}

function topTypes(editor: Editor): string[] {
  const types: string[] = [];
  editor.state.doc.forEach((n) => void types.push(n.type.name));
  return types;
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

  it("the whole document: blocks and leading front matter replace it (AllSelection row)", () => {
    const { editor } = realEditor("old\n");
    insert(
      editor,
      { from: 0, kind: "all", to: editor.state.doc.content.size },
      "---\nt: 1\n---\n\n# New",
    );
    expect(topTypes(editor)).toEqual(["frontmatter", "heading"]);
    editor.destroy();
  });

  it("refuses front matter as a second block even for the whole document (rule 5b)", () => {
    // The parser only makes front matter at the document start (`# A\n\n---\nt: 1\n---`
    // parses as heading · rule · heading — plan review M2), so this fragment is built by hand
    // to pin the `index === 0` check; through markdown the case is defensive.
    const { editor } = realEditor("old\n");
    const { schema } = editor;
    const fragment = Fragment.from([
      schema.nodes.heading.create({ level: 1 }, schema.text("A")),
      schema.nodes.frontmatter.create(null, schema.text("t: 1")),
    ]);
    expect(
      codeOf(() =>
        buildInsertion(
          editor.state,
          { from: 0, kind: "all", to: editor.state.doc.content.size },
          { fragment, kind: "markdown", source: "(hand-built)" },
          "insertMarkdown",
        ),
      ),
    ).toBe("cannot-insert-here");
    editor.destroy();
  });

  it("inside inline code the markdown goes in literally and stays code (2026-10-04 decision)", () => {
    // No marker: a caret inside the span would make the reveal expand it. "a " 1-3, code 3-7.
    const { editor } = realEditor("a `code` b\n");
    insert(editor, { from: 5, kind: "text", to: 5 }, "**x**");
    expect(serializeLiveDoc(editor)).toBe("a `co**x**de` b\n");
    editor.destroy();
  });

  it("a block node selection replaces that node only (parent is not a textblock)", () => {
    const { editor } = realEditor("alpha\n\n```\ncode\n```\n\nomega\n");
    let codeAt = -1;
    editor.state.doc.forEach((n, pos) => {
      if (n.type.name === "codeBlock") codeAt = pos;
    });
    const node = editor.state.doc.nodeAt(codeAt)!;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        NodeSelection.create(editor.state.doc, codeAt),
      ),
    );
    insert(
      editor,
      { from: codeAt, kind: "node", to: codeAt + node.nodeSize },
      "## H",
    );
    expect(topTypes(editor)).toEqual(["paragraph", "heading", "paragraph"]);
    editor.destroy();
  });

  it("an image the loader left inside a paragraph follows the text rules (spec §6.2, P7)", () => {
    const inline = realEditor("이미지: ![로고](x.png) 끝\n");
    let img = -1;
    inline.editor.state.doc.descendants((n, pos) => {
      if (n.type.name === "image") img = pos;
    });
    expect(inline.editor.state.doc.resolve(img).parent.type.name).toBe(
      "paragraph",
    );
    insert(inline.editor, { from: img, kind: "node", to: img + 1 }, "**b**");
    expect(inline.editor.state.doc.textContent).toBe("이미지: b 끝");
    inline.editor.destroy();
    // A block result splits the paragraph — by the parent axis, as intended (2026-10-04).
    const block = realEditor("이미지: ![로고](x.png) 끝\n");
    let img2 = -1;
    block.editor.state.doc.descendants((n, pos) => {
      if (n.type.name === "image") img2 = pos;
    });
    insert(block.editor, { from: img2, kind: "node", to: img2 + 1 }, "## H");
    expect(topTypes(block.editor)).toEqual([
      "paragraph",
      "heading",
      "paragraph",
    ]);
    block.editor.destroy();
  });

  it("rule 5c refuses a split above the textblock — and catches the table split without 5a", () => {
    // Sibling for rule (c): with 5a out of the way (the target is not a cell paragraph
    // here, so 5a cannot fire), a heading into a cell would split the table; (c) is what
    // stops that. Measured shape: §6.1 row "## H → 표 셀".
    const { editor, from, to } = realEditor(
      "| a | b |\n| --- | --- |\n| c @@ | d |\n",
    );
    const fragment = markdownToProsemirror("## H", editor.schema).content;
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
