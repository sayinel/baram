// §388 spec 0067 §6.2 · §11-3 — the insertion rules for node selections, the whole document
// and front matter: which slice closes, which parent decides, and where front matter may go.
import { Fragment } from "@tiptap/pm/model";
import { describe, expect, it, vi } from "vitest";

const { openUrl } = vi.hoisted(() => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import { serializeLiveDoc } from "../../utils/editor/serialize-live-doc";
import { buildInsertion } from "../editor-insert-rules";
import {
  insert,
  nodeTarget,
  refuseAt,
  refused,
  topTypes,
} from "./insert-fixtures";
import { codeOf, realEditor } from "./real-editor";

const CELL = "| a | b |\n| --- | --- |\n| c @@ | d |\n";

describe("node, whole-document and front matter rules (spec 0067 §6.2)", () => {
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

  it("a block node selection replaces that node only (parent is not a textblock)", () => {
    const { editor } = realEditor("alpha\n\n```\ncode\n```\n\nomega\n");
    insert(editor, nodeTarget(editor, "codeBlock"), "## H");
    expect(topTypes(editor)).toEqual(["paragraph", "heading", "paragraph"]);
    editor.destroy();
  });

  it("an image the loader left inside a paragraph follows the text rules (spec §6.2, P7)", () => {
    // Routing by node kind would close the slice and split the paragraph even for an inline
    // result; the top-level types and the bold mark are what tell the two routings apart.
    const inline = realEditor("이미지: ![로고](x.png) 끝\n");
    const img = nodeTarget(inline.editor, "image");
    expect(inline.editor.state.doc.resolve(img.from).parent.type.name).toBe(
      "paragraph",
    );
    insert(
      inline.editor,
      { from: img.from, kind: "node", to: img.to },
      "**b**",
    );
    expect(topTypes(inline.editor)).toEqual(["paragraph"]);
    expect(inline.editor.state.doc.textContent).toBe("이미지: b 끝");
    let boldB = false;
    inline.editor.state.doc.descendants((n) => {
      if (n.isText && n.text === "b") {
        boldB = n.marks.some((m) => m.type.name === "bold");
      }
    });
    expect(boldB).toBe(true);
    inline.editor.destroy();
    // A block result splits the paragraph — by the parent axis, as intended (2026-10-04).
    const block = realEditor("이미지: ![로고](x.png) 끝\n");
    const img2 = nodeTarget(block.editor, "image");
    insert(
      block.editor,
      { from: img2.from, kind: "node", to: img2.to },
      "## H",
    );
    expect(topTypes(block.editor)).toEqual([
      "paragraph",
      "heading",
      "paragraph",
    ]);
    block.editor.destroy();
  });

  // I1 · rule 5a by the selected node's parent.
  it("a node selection of a cell paragraph refuses blocks, accepts one paragraph (rule 5a)", () => {
    const refusal = realEditor(CELL);
    const target = nodeTarget(refusal.editor, "paragraph", "c");
    expect(refusal.editor.state.doc.resolve(target.from).parent.type.name).toBe(
      "tableCell",
    );
    refuseAt(refusal.editor, target, "p1\n\np2");
    refuseAt(refusal.editor, target, "## H");
    refusal.editor.destroy();
    // Positive sibling: one paragraph replaces the cell's paragraph node.
    const ok = realEditor(CELL);
    insert(ok.editor, nodeTarget(ok.editor, "paragraph", "c"), "**z**");
    expect(topTypes(ok.editor)).toEqual(["table"]);
    expect(serializeLiveDoc(ok.editor)).toContain("**z**");
    ok.editor.destroy();
  });

  // I3 · §11-3 front matter and node rows.
  it("a front matter node selection accepts a result that starts with front matter", () => {
    const { editor } = realEditor("---\nt: 0\n---\n\nbody\n");
    const target = nodeTarget(editor, "frontmatter");
    expect(target.from).toBe(0);
    insert(editor, target, "---\nt: 1\n---\n\n# New");
    expect(topTypes(editor)).toEqual(["frontmatter", "heading", "paragraph"]);
    expect(editor.state.doc.firstChild!.textContent).toBe("t: 1");
    editor.destroy();
  });

  it("whole-content selection of the first paragraph accepts leading front matter, the second refuses", () => {
    // The widened range starts at 0 only for the first paragraph; the check must use it.
    const first = realEditor("@@mid@@\n\nomega\n");
    insert(
      first.editor,
      { from: first.from, kind: "text", to: first.to },
      "---\nt: 1\n---\n\n# New",
    );
    expect(topTypes(first.editor)[0]).toBe("frontmatter");
    first.editor.destroy();
    refused("alpha\n\n@@mid@@\n", "---\nt: 1\n---\n\n# New");
  });

  it("an inline atom node selection goes inline and leaves the top level alone", () => {
    for (const source of ["a [[Note]] b\n", "a $x$ b\n"]) {
      const { editor } = realEditor(source);
      const name = source.includes("[[") ? "wikilink" : "mathInline";
      const target = nodeTarget(editor, name);
      insert(editor, target, "**b**");
      expect(topTypes(editor)).toEqual(["paragraph"]);
      let remaining = 0;
      editor.state.doc.descendants((n) => {
        if (n.type.name === name) remaining += 1;
      });
      expect(remaining).toBe(0);
      expect(editor.state.doc.textContent).toBe("a b b");
      editor.destroy();
    }
  });

  it("a node selection of a top-level image or table replaces only that node", () => {
    const image = realEditor("alpha\n\n![a](x.png)\n\nomega\n");
    expect(topTypes(image.editor)).toEqual(["paragraph", "image", "paragraph"]);
    insert(image.editor, nodeTarget(image.editor, "image"), "## H");
    expect(topTypes(image.editor)).toEqual([
      "paragraph",
      "heading",
      "paragraph",
    ]);
    image.editor.destroy();
    const table = realEditor(
      "alpha\n\n| a | b |\n| --- | --- |\n| c | d |\n\nomega\n",
    );
    insert(table.editor, nodeTarget(table.editor, "table"), "## H");
    expect(topTypes(table.editor)).toEqual([
      "paragraph",
      "heading",
      "paragraph",
    ]);
    table.editor.destroy();
  });
});
