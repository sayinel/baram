// §5.5 — shared table geometry + whole row/column selection helpers.
import { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { afterEach, describe, expect, it } from "vitest";

import {
  columnAnchorPos,
  computeHandleStyle,
  findCellPos,
  rowAnchorPos,
  selectColumn,
  selectRow,
} from "../../components/toolbar/table-selection";
import { createBaramExtensions } from "../../extensions";

// 2 rows × 3 cols; row 1 = headers A/B/C, row 2 = 1/2/3.
const TABLE_HTML =
  "<table><tr><th>A</th><th>B</th><th>C</th></tr>" +
  "<tr><td>1</td><td>2</td><td>3</td></tr></table>";

let editors: Editor[] = [];
function makeEditor(): Editor {
  const e = new Editor({
    extensions: createBaramExtensions(),
    content: TABLE_HTML,
  });
  editors.push(e);
  return e;
}
afterEach(() => {
  editors.forEach((e) => e.destroy());
  editors = [];
});

/** Position of the table node (before it) in the doc. */
function tablePos(editor: Editor): number {
  let pos = -1;
  editor.state.doc.descendants((n, p) => {
    if (pos === -1 && n.type.name === "table") pos = p;
    return pos === -1;
  });
  return pos;
}

describe("computeHandleStyle (zoom-aware)", () => {
  it("centers a column grip above the column at zoom 1", () => {
    // grip long side = 18, short side = 14; col grip is horizontal, sits above the top edge
    expect(computeHandleStyle({ axis: "col", x: 200, y: 100 }, 1)).toEqual({
      left: 200 - 9, // x - MAIN/2
      top: 100 - 14 - 2, // y - CROSS - GAP
    });
  });
  it("centers a row grip left of the row at zoom 1", () => {
    expect(computeHandleStyle({ axis: "row", x: 100, y: 200 }, 1)).toEqual({
      left: 100 - 14 - 2, // x - CROSS - GAP
      top: 200 - 9, // y - MAIN/2
    });
  });
  it("divides visual coords by zoom (fixed-overlay scaling)", () => {
    const s = computeHandleStyle({ axis: "col", x: 200, y: 100 }, 2);
    expect(s).toEqual({ left: 200 / 2 - 9, top: 100 / 2 - 14 - 2 });
  });
});

describe("findCellPos / anchors", () => {
  it("resolves distinct cell positions per column in row 0", () => {
    const editor = makeEditor();
    const tp = tablePos(editor);
    const c0 = columnAnchorPos(editor, tp, 0);
    const c1 = columnAnchorPos(editor, tp, 1);
    const c2 = columnAnchorPos(editor, tp, 2);
    expect(c0).not.toBeNull();
    expect(c1).not.toBeNull();
    expect(c2).not.toBeNull();
    expect(new Set([c0, c1, c2]).size).toBe(3);
    expect(findCellPos(editor, tp, 0, 5)).toBeNull(); // out of range
  });
});

describe("selectColumn / selectRow", () => {
  it("selects all cells in a column (2 rows → 2 cells)", () => {
    const editor = makeEditor();
    const tp = tablePos(editor);
    selectColumn(editor, columnAnchorPos(editor, tp, 1)!);
    const sel = editor.state.selection;
    expect(sel).toBeInstanceOf(CellSelection);
    let count = 0;
    (sel as CellSelection).forEachCell(() => {
      count++;
    });
    expect(count).toBe(2);
  });

  it("selects all cells in a row (3 cols → 3 cells)", () => {
    const editor = makeEditor();
    const tp = tablePos(editor);
    selectRow(editor, rowAnchorPos(editor, tp, 1)!);
    const sel = editor.state.selection;
    expect(sel).toBeInstanceOf(CellSelection);
    let count = 0;
    (sel as CellSelection).forEachCell(() => {
      count++;
    });
    expect(count).toBe(3);
  });
});
