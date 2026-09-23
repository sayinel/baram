// §377 Rows and arrow keys over the symbol picker's grid.
//
// The grid is rows of at most SYMBOL_GRID_COLUMNS cells; a section's last row
// is often short, and no row holds two sections. The rows are built here and
// the picker draws one element per row, so the column count is in this file
// only — the stylesheet never repeats it. Left and Right run through the rows
// in reading order; Up and Down keep the column where the next row is long
// enough and take its last cell where it is not. Nothing wraps from the last
// cell to the first.
import type { SymbolSuggestionItem } from "../../extensions/plugins/symbol-search";
import type {
  SymbolSection,
  SymbolSectionId,
} from "../../extensions/plugins/symbol-sections";

export const SYMBOL_GRID_COLUMNS = 8;

export type GridArrow = "ArrowDown" | "ArrowLeft" | "ArrowRight" | "ArrowUp";

export interface GridPosition {
  readonly col: number;
  readonly row: number;
}

export interface GridRow {
  readonly items: readonly SymbolSuggestionItem[];
  readonly sectionId: SymbolSectionId;
}

/** `pos` pulled into `rows`: the nearest cell that exists, or null when there is none. */
export function clampPosition(
  rows: readonly GridRow[],
  pos: GridPosition,
): GridPosition | null {
  if (rows.length === 0) return null;
  const row = Math.min(pos.row, rows.length - 1);
  return { col: Math.min(pos.col, rows[row].items.length - 1), row };
}

export function isGridArrow(key: string): key is GridArrow {
  return (
    key === "ArrowDown" ||
    key === "ArrowLeft" ||
    key === "ArrowRight" ||
    key === "ArrowUp"
  );
}

/** Where `key` takes the highlight from `pos`, which must be a cell of `rows`. */
export function moveInGrid(
  rows: readonly GridRow[],
  pos: GridPosition,
  key: GridArrow,
): GridPosition {
  const { col, row } = pos;
  const lastRow = rows.length - 1;
  const lastCol = (r: number): number => rows[r].items.length - 1;
  switch (key) {
    case "ArrowDown":
      return row < lastRow
        ? { col: Math.min(col, lastCol(row + 1)), row: row + 1 }
        : pos;
    case "ArrowLeft":
      if (col > 0) return { col: col - 1, row };
      return row > 0 ? { col: lastCol(row - 1), row: row - 1 } : pos;
    case "ArrowRight":
      if (col < lastCol(row)) return { col: col + 1, row };
      return row < lastRow ? { col: 0, row: row + 1 } : pos;
    case "ArrowUp":
      return row > 0
        ? { col: Math.min(col, lastCol(row - 1)), row: row - 1 }
        : pos;
  }
}

/** Each section cut into rows of `columns`; an empty section gets none. */
export function toGridRows(
  sections: readonly SymbolSection[],
  columns = SYMBOL_GRID_COLUMNS,
): GridRow[] {
  const rows: GridRow[] = [];
  for (const { id, items } of sections) {
    for (let start = 0; start < items.length; start += columns) {
      rows.push({ items: items.slice(start, start + columns), sectionId: id });
    }
  }
  return rows;
}
