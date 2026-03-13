import type { NodeTransformerEntry } from "../types";
// table-transformer.ts — §5.5 GFM Table mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode } from "mdast";

interface MdastTable extends MdastNode {
  align?: (null | string)[];
  children: MdastTableRow[];
  type: "table";
}

interface MdastTableCell extends MdastNode {
  children: MdastNode[];
  type: "tableCell";
}

interface MdastTableRow extends MdastNode {
  children: MdastTableCell[];
  type: "tableRow";
}

/** Extract plain text from mdast table cell children (for marker detection) */
function extractCellText(cell: MdastTableCell): string {
  let text = "";
  function walk(node: MdastNode) {
    if ((node as unknown as { value?: string }).value)
      text += (node as unknown as { value: string }).value;
    if ((node as unknown as { children?: MdastNode[] }).children) {
      for (const child of (node as unknown as { children: MdastNode[] })
        .children)
        walk(child);
    }
  }
  for (const child of cell.children) walk(child);
  return text;
}

export const tableTransformer: NodeTransformerEntry = {
  mdastType: "table",
  pmType: "table",

  mdastToPm(node: MdastNode, schema: Schema, convertChildren) {
    const table = node as MdastTable;
    const align = table.align || [];
    const rowCount = table.children.length;

    // Pass 1: Build 2D content array and check for merge markers
    const content: string[][] = [];
    const rawCells: MdastTableCell[][] = [];
    let hasMergeMarkers = false;

    for (let r = 0; r < rowCount; r++) {
      content[r] = [];
      rawCells[r] = [];
      const row = table.children[r];
      for (let c = 0; c < row.children.length; c++) {
        const cell = row.children[c];
        rawCells[r][c] = cell;
        const text = extractCellText(cell).trim();
        content[r][c] = text;
        if (text === "<" || text === "^") hasMergeMarkers = true;
      }
    }

    if (!hasMergeMarkers) {
      // Existing logic — no markers, standard GFM table
      const rows: PmNode[] = [];
      table.children.forEach((row, rowIndex) => {
        const cells: PmNode[] = [];
        row.children.forEach((cell, colIndex) => {
          const cellChildren =
            (cell as unknown as { children: MdastNode[] }).children || [];
          const cellContent =
            cellChildren.length > 0
              ? convertChildren({
                  children: cellChildren,
                } as unknown as import("mdast").Parent)
              : [];
          const pmContent =
            cellContent.length > 0
              ? cellContent
              : [schema.nodes.paragraph.create()];
          const cellAttrs = {
            colspan: 1,
            rowspan: 1,
            alignment: align[colIndex] || null,
          };
          if (rowIndex === 0) {
            cells.push(schema.nodes.tableHeader.create(cellAttrs, pmContent));
          } else {
            cells.push(schema.nodes.tableCell.create(cellAttrs, pmContent));
          }
        });
        rows.push(schema.nodes.tableRow.create(null, cells));
      });
      return schema.nodes.table.create(null, rows);
    }

    // --- Merge marker path ---
    const colCount = Math.max(...table.children.map((r) => r.children.length));
    const attrs: { colspan: number; consumed: boolean; rowspan: number }[][] =
      [];
    for (let r = 0; r < rowCount; r++) {
      attrs[r] = [];
      for (let c = 0; c < colCount; c++) {
        attrs[r][c] = { colspan: 1, rowspan: 1, consumed: false };
      }
    }

    // Pass 2: Resolve colspan ('<' markers, per-row left→right)
    for (let r = 0; r < rowCount; r++) {
      for (let c = 1; c < (content[r]?.length || 0); c++) {
        if (content[r][c] === "<") {
          let sourceCol = c - 1;
          while (sourceCol > 0 && content[r][sourceCol] === "<") {
            sourceCol--;
          }
          if (content[r][sourceCol] !== "<" && content[r][sourceCol] !== "^") {
            attrs[r][sourceCol].colspan++;
            attrs[r][c].consumed = true;
          }
        }
      }
    }

    // Pass 3: Resolve rowspan ('^' markers, per-row with deduplication)
    for (let r = 1; r < rowCount; r++) {
      const rowspanApplied = new Set<string>();
      for (let c = 0; c < (content[r]?.length || 0); c++) {
        if (content[r][c] === "^" && !attrs[r][c].consumed) {
          let sourceRow = r - 1;
          while (sourceRow > 0 && content[sourceRow][c] === "^") {
            sourceRow--;
          }
          let sourceCol = c;
          if (attrs[sourceRow]?.[sourceCol]?.consumed) {
            while (sourceCol > 0 && attrs[sourceRow][sourceCol].consumed) {
              sourceCol--;
            }
          }
          const mainKey = `${sourceRow},${sourceCol}`;
          if (!rowspanApplied.has(mainKey)) {
            attrs[sourceRow][sourceCol].rowspan++;
            rowspanApplied.add(mainKey);
          }
          attrs[r][c].consumed = true;
        }
      }
    }

    // Pass 4: Build PM nodes (skip rows where all cells are consumed)
    const rows: PmNode[] = [];
    for (let r = 0; r < rowCount; r++) {
      const cells: PmNode[] = [];
      for (let c = 0; c < (content[r]?.length || 0); c++) {
        if (!attrs[r][c].consumed) {
          const cell = rawCells[r][c];
          const cellChildren =
            (cell as unknown as { children: MdastNode[] }).children || [];
          const cellContent =
            cellChildren.length > 0
              ? convertChildren({
                  children: cellChildren,
                } as unknown as import("mdast").Parent)
              : [];
          const pmContent =
            cellContent.length > 0
              ? cellContent
              : [schema.nodes.paragraph.create()];
          const cellAttrs = {
            colspan: attrs[r][c].colspan,
            rowspan: attrs[r][c].rowspan,
            alignment: align[c] || null,
          };
          if (r === 0) {
            cells.push(schema.nodes.tableHeader.create(cellAttrs, pmContent));
          } else {
            cells.push(schema.nodes.tableCell.create(cellAttrs, pmContent));
          }
        }
      }
      // Guard: skip rows where all cells are consumed (avoids ProseMirror
      // RangeError — tableRow requires 1+ children)
      if (cells.length > 0) {
        rows.push(schema.nodes.tableRow.create(null, cells));
      }
    }
    return schema.nodes.table.create(null, rows);
  },

  pmToMdast(node: PmNode, convertChildren): MdastNode {
    // Step 1: Calculate logical column count from colspan attrs
    let maxCols = 0;
    node.forEach((row) => {
      let cols = 0;
      row.forEach((cell) => {
        cols += (cell.attrs.colspan as number) || 1;
      });
      if (cols > maxCols) maxCols = cols;
    });

    // Step 2: Build 2D grid (rows × cols), null = unfilled
    const rowCount = node.childCount;
    const grid: (null | {
      cell: PmNode;
      isMain: boolean;
      mainCol: number;
      mainRow: number;
    })[][] = [];
    for (let r = 0; r < rowCount; r++) {
      grid.push(new Array(maxCols).fill(null));
    }

    // Step 3: Fill grid from PM cells, respecting colspan + rowspan
    let hasMerge = false;
    node.forEach((row, _offset, rowIndex) => {
      let gridCol = 0;
      row.forEach((cell) => {
        // Skip past already-filled cells (from rowspan above)
        while (gridCol < maxCols && grid[rowIndex][gridCol] !== null) {
          gridCol++;
        }
        const cs = (cell.attrs.colspan as number) || 1;
        const rs = (cell.attrs.rowspan as number) || 1;
        if (cs > 1 || rs > 1) hasMerge = true;
        for (let dr = 0; dr < rs; dr++) {
          for (let dc = 0; dc < cs; dc++) {
            if (rowIndex + dr < rowCount && gridCol + dc < maxCols) {
              grid[rowIndex + dr][gridCol + dc] = {
                cell,
                isMain: dr === 0 && dc === 0,
                mainRow: rowIndex,
                mainCol: gridCol,
              };
            }
          }
        }
        gridCol += cs;
      });
    });

    // Step 4: Serialize grid to GFM mdast rows
    const rows: MdastTableRow[] = [];
    const align: (null | string)[] = [];
    let alignCollected = false;

    for (let r = 0; r < rowCount; r++) {
      const cells: MdastTableCell[] = [];
      for (let c = 0; c < maxCols; c++) {
        const entry = grid[r][c];
        if (entry && entry.isMain) {
          // Main cell — serialize its content
          const children = convertChildren(entry.cell);
          const cellChildren =
            children.length === 1 && children[0].type === "paragraph"
              ? (children[0] as unknown as { children: MdastNode[] }).children
              : children;
          cells.push({
            type: "tableCell",
            children: cellChildren.length > 0 ? cellChildren : [],
          } as MdastTableCell);

          if (!alignCollected) {
            align.push((entry.cell.attrs.alignment as string) || null);
          }
        } else if (hasMerge && entry) {
          // Merge marker cell
          const marker = entry.mainRow === r ? "<" : "^";
          cells.push({
            type: "tableCell",
            children: [{ type: "text", value: marker } as unknown as MdastNode],
          } as MdastTableCell);

          if (!alignCollected) {
            align.push((entry.cell.attrs.alignment as string) || null);
          }
        } else {
          // Spanned or empty cell (no merge) — emit empty content
          cells.push({
            type: "tableCell",
            children: [],
          } as MdastTableCell);

          if (!alignCollected) {
            align.push(
              entry ? (entry.cell.attrs.alignment as string) || null : null,
            );
          }
        }
      }
      alignCollected = true;
      rows.push({
        type: "tableRow",
        children: cells,
      } as MdastTableRow);
    }

    return {
      type: "table",
      align: align.some((a) => a !== null) ? align : undefined,
      children: rows,
    } as unknown as MdastNode;
  },
};
