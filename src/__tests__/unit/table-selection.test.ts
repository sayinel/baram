// §5.5 — shared table geometry + whole row/column selection helpers.
import { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { afterEach, describe, expect, it } from "vitest";

import {
  axisHasSpan,
  boundaryToDestIndex,
  columnAnchorPos,
  computeDropIndicatorStyle,
  computeHandleStyle,
  findCellPos,
  moveColumn,
  moveRow,
  nearestBoundaryIndex,
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

/** First-row cell texts, left→right. */
function headerTexts(editor: Editor): string[] {
  const out: string[] = [];
  const table = editor.state.doc.nodeAt(tablePos(editor));
  table?.firstChild?.forEach((cell) => out.push(cell.textContent));
  return out;
}

describe("boundaryToDestIndex", () => {
  it("maps a right-side boundary to remove-then-insert index", () => {
    expect(boundaryToDestIndex(0, 3)).toBe(2); // drag col0 to far right of 3 cols
    expect(boundaryToDestIndex(2, 0)).toBe(0); // drag col2 to far left
    expect(boundaryToDestIndex(1, 1)).toBe(1); // onto its own left edge
  });
});

describe("moveColumn / moveRow", () => {
  it("moves the first column to the far right", () => {
    const editor = makeEditor();
    const tp = tablePos(editor);
    expect(headerTexts(editor)).toEqual(["A", "B", "C"]);
    const ok = moveColumn(editor, tp, 0, 3); // boundary after last col
    expect(ok).toBe(true);
    expect(headerTexts(editor)).toEqual(["B", "C", "A"]);
  });

  it("no-ops when dropping onto its own edge", () => {
    const editor = makeEditor();
    const tp = tablePos(editor);
    expect(moveColumn(editor, tp, 1, 1)).toBe(false);
    expect(headerTexts(editor)).toEqual(["A", "B", "C"]);
  });

  it("moves a row (row 0 → below row 1) changing the header row", () => {
    const editor = makeEditor();
    const tp = tablePos(editor);
    const ok = moveRow(editor, tp, 0, 2); // boundary after last row
    expect(ok).toBe(true);
    // header row is now the old data row → first cell text is "1"
    expect(headerTexts(editor)[0]).toBe("1");
  });

  it("no-ops when dropping a row onto its own edge", () => {
    const editor = makeEditor();
    const tp = tablePos(editor);
    expect(moveRow(editor, tp, 1, 1)).toBe(false);
    expect(headerTexts(editor)).toEqual(["A", "B", "C"]);
  });
});

describe("axisHasSpan (merged-cell guard)", () => {
  it("is false for a plain table", () => {
    const editor = makeEditor();
    expect(axisHasSpan(editor, tablePos(editor), "col")).toBe(false);
    expect(axisHasSpan(editor, tablePos(editor), "row")).toBe(false);
  });

  it("detects colspan / rowspan", () => {
    const e = new Editor({
      extensions: createBaramExtensions(),
      content:
        "<table><tr><th colspan='2'>AB</th></tr>" +
        "<tr><td>1</td><td>2</td></tr></table>",
    });
    editors.push(e);
    expect(axisHasSpan(e, tablePos(e), "col")).toBe(true);
  });

  it("detects rowspan on the row axis", () => {
    const e = new Editor({
      extensions: createBaramExtensions(),
      content:
        "<table><tr><th rowspan='2'>A</th><th>B</th></tr>" +
        "<tr><td>2</td></tr></table>",
    });
    editors.push(e);
    expect(axisHasSpan(e, tablePos(e), "row")).toBe(true);
  });
});

describe("nearestBoundaryIndex", () => {
  it("snaps to the closest gridline", () => {
    const edges = [100, 200, 320]; // 2 columns → 3 boundaries
    expect(nearestBoundaryIndex(edges, 105)).toBe(0);
    expect(nearestBoundaryIndex(edges, 170)).toBe(1);
    expect(nearestBoundaryIndex(edges, 400)).toBe(2);
  });
});

describe("computeDropIndicatorStyle", () => {
  const rect = { left: 100, top: 50, width: 300, height: 120 } as DOMRect;
  it("draws a vertical line for a column drop (zoom 1)", () => {
    expect(computeDropIndicatorStyle("col", 200, rect, 1)).toEqual({
      left: 200,
      top: 50,
      width: 2,
      height: 120,
    });
  });
  it("draws a horizontal line for a row drop and divides by zoom", () => {
    expect(computeDropIndicatorStyle("row", 90, rect, 2)).toEqual({
      left: 100 / 2,
      top: 90 / 2,
      width: 300 / 2,
      height: 2,
    });
  });
});
