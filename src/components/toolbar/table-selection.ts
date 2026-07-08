// §5.5 — shared table geometry, whole row/column selection, and (Task 5) reorder.
// Pure/logic helpers live here so the overlay .tsx files export only components
// (mirrors table-insert-coords.ts).
import type { Editor } from "@tiptap/react";

import { CellSelection } from "@tiptap/pm/tables";

/** Anchor describing where a grip handle should sit (visual-viewport px). */
export interface HandleAnchor {
  /** "col" → grip above a column; "row" → grip left of a row. */
  axis: "col" | "row";
  /** Column center x (col) or table left edge x (row). */
  x: number;
  /** Table top edge y (col) or row center y (row). */
  y: number;
}

// Grip is a rounded pill: MAIN along the axis it labels, CROSS across it.
const HANDLE_MAIN = 18;
const HANDLE_CROSS = 14;
const HANDLE_GAP = 2; // lift off the table border

/** Cell-before pos for a column's top (row 0) cell — anchor for colSelection. */
export function columnAnchorPos(
  editor: Editor,
  tablePos: number,
  colIdx: number,
): null | number {
  return findCellPos(editor, tablePos, 0, colIdx);
}

/**
 * Zoom-aware `position: fixed` offset for a grip. The grip is a fixed element
 * inside the CSS-zoom container (`.editor-area-scroll`), which WKWebView renders
 * at (zoom × top, zoom × left). anchor.x/y are visual-viewport coords, so
 * dividing by zoom cancels the render-time scaling; the grip's fixed size and the
 * gap are content-space sizes that scale with it, so they stay un-divided.
 */
export function computeHandleStyle(
  anchor: HandleAnchor,
  zoom: number,
): { left: number; top: number } {
  if (anchor.axis === "col") {
    return {
      left: anchor.x / zoom - HANDLE_MAIN / 2,
      top: anchor.y / zoom - HANDLE_CROSS - HANDLE_GAP,
    };
  }
  return {
    left: anchor.x / zoom - HANDLE_CROSS - HANDLE_GAP,
    top: anchor.y / zoom - HANDLE_MAIN / 2,
  };
}

/**
 * Find the PM position directly in front of the cell at (targetRow, targetCol).
 * Moved verbatim from TableInsertButtons so both the insert button and the
 * selection handles share one implementation.
 */
export function findCellPos(
  editor: Editor,
  tablePos: number,
  targetRow: number,
  targetCol: number,
): null | number {
  const tableNode = editor.state.doc.nodeAt(tablePos);
  if (!tableNode) return null;

  let rowIdx = 0;
  let result: null | number = null;

  tableNode.forEach((row, rowOffset) => {
    if (result !== null) return;
    if (rowIdx === targetRow) {
      let colIdx = 0;
      row.forEach((_cell, cellOffset) => {
        if (result !== null) return;
        if (colIdx === targetCol) {
          result = tablePos + 1 + rowOffset + 1 + cellOffset;
        }
        colIdx++;
      });
    }
    rowIdx++;
  });

  return result;
}

/** Cell-before pos for a row's first (col 0) cell — anchor for rowSelection. */
export function rowAnchorPos(
  editor: Editor,
  tablePos: number,
  rowIdx: number,
): null | number {
  return findCellPos(editor, tablePos, rowIdx, 0);
}

/** Select the entire column containing the cell at `cellBeforePos`. */
export function selectColumn(editor: Editor, cellBeforePos: number): void {
  const $cell = editor.state.doc.resolve(cellBeforePos);
  const sel = CellSelection.colSelection($cell);
  editor.view.dispatch(editor.state.tr.setSelection(sel));
  editor.view.focus();
}

/** Select the entire row containing the cell at `cellBeforePos`. */
export function selectRow(editor: Editor, cellBeforePos: number): void {
  const $cell = editor.state.doc.resolve(cellBeforePos);
  const sel = CellSelection.rowSelection($cell);
  editor.view.dispatch(editor.state.tr.setSelection(sel));
  editor.view.focus();
}
