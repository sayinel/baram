// §5.5 — the transaction that clears a marked table's widths (D5), and the
// guard that keeps the width measurer away from a table that is not laid out (D10).
import { Editor, getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";

import { stripTableWidthComments } from "../../pipeline/convert-table-colwidths";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import { createBaramExtensions } from "../index";
import { buildClearTableWidthsTransaction } from "../nodes/plugins/table-col-resize";

const schema = getSchema(createBaramExtensions());

const MARKED =
  "<!-- colwidths:120,80 -->\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n";
const PLAIN = "| C | D |\n| --- | --- |\n| 3 | 4 |\n";

function stateOf(md: string): EditorState {
  return EditorState.create({ doc: markdownToProsemirror(md, schema), schema });
}

function tablesOf(state: EditorState) {
  const tables: { cells: { colwidth: unknown; userResized: unknown }[] }[] = [];
  state.doc.descendants((node) => {
    if (node.type.name !== "table") return true;
    const cells: { colwidth: unknown; userResized: unknown }[] = [];
    node.descendants((cell) => {
      if (cell.type.name === "tableCell" || cell.type.name === "tableHeader") {
        cells.push({
          colwidth: cell.attrs.colwidth,
          userResized: cell.attrs.userResized,
        });
        return false;
      }
      return true;
    });
    tables.push({ cells });
    return false;
  });
  return tables;
}

describe("buildClearTableWidthsTransaction", () => {
  it("clears every cell of a marked table and leaves an unmarked table alone", () => {
    const state = stateOf(`${MARKED}\nmid\n\n${PLAIN}`);
    const before = tablesOf(state);
    expect(before[0].cells.every((c) => c.userResized === true)).toBe(true);
    expect(before[0].cells.every((c) => c.colwidth !== null)).toBe(true);

    const tr = buildClearTableWidthsTransaction(state);
    expect(tr).not.toBeNull();
    const after = tablesOf(state.apply(tr!));
    expect(after[0].cells).toHaveLength(4);
    for (const c of after[0].cells) {
      expect(c.colwidth).toBeNull();
      expect(c.userResized).toBe(false);
    }
    expect(after[1]).toEqual(before[1]);
  });

  it("reaches a marked table inside a blockquote", () => {
    const cell = schema.nodes.tableCell.create(
      { colwidth: [120], userResized: true },
      schema.nodes.paragraph.create(null, [schema.text("A")]),
    );
    const table = schema.nodes.table.create(null, [
      schema.nodes.tableRow.create(null, [cell]),
    ]);
    const state = EditorState.create({
      doc: schema.nodes.doc.create(null, [
        schema.nodes.blockquote.create(null, [table]),
      ]),
      schema,
    });
    expect(tablesOf(state)).toHaveLength(1);
    const tr = buildClearTableWidthsTransaction(state);
    expect(tr).not.toBeNull();
    for (const c of tablesOf(state.apply(tr!))[0].cells) {
      expect(c.colwidth).toBeNull();
      expect(c.userResized).toBe(false);
    }
  });

  it("returns null when no table is marked", () => {
    expect(buildClearTableWidthsTransaction(stateOf(PLAIN))).toBeNull();
  });

  it("stays out of the undo history", () => {
    const tr = buildClearTableWidthsTransaction(stateOf(MARKED));
    expect(tr!.getMeta("addToHistory")).toBe(false);
  });

  it("ends at the same markdown as stripping the text", () => {
    const md = prosemirrorToMarkdown(
      markdownToProsemirror(`${MARKED}\nmid\n\n${PLAIN}`, schema),
    );
    expect(md).toContain("colwidths:");
    const state = stateOf(md);
    const viaDoc = prosemirrorToMarkdown(
      state.apply(buildClearTableWidthsTransaction(state)!).doc,
    );
    expect(viaDoc).toBe(stripTableWidthComments(md));
  });
});

describe("table width measuring", () => {
  let editor: Editor | undefined;
  let host: HTMLElement | undefined;

  afterEach(() => {
    editor?.destroy();
    host?.remove();
    editor = undefined;
    host = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mountMeasured(offsetWidth: number) {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(
      offsetWidth,
    );
    host = document.createElement("div");
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: createBaramExtensions(),
    });
    // A one-column table without colwidth; the plugin view's update() measures it.
    const doc = markdownToProsemirror("| A |\n| --- |\n| 1 |\n", editor.schema);
    editor.view.dispatch(
      editor.state.tr.replaceWith(
        0,
        editor.state.doc.content.size,
        doc.content,
      ),
    );
    return tablesOf(editor.state)[0].cells.map((c) => c.colwidth);
  }

  it("does not measure a table that is not laid out", () => {
    const widths = mountMeasured(0);
    expect(widths.length).toBeGreaterThan(0);
    expect(widths.every((w) => w === null)).toBe(true);
  });

  it("measures a laid-out table", () => {
    const widths = mountMeasured(120);
    expect(widths.length).toBeGreaterThan(0);
    expect(widths.every((w) => Array.isArray(w) && w[0] === 120)).toBe(true);
  });
});
