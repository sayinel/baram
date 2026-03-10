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

export const tableTransformer: NodeTransformerEntry = {
  mdastType: "table",
  pmType: "table",

  mdastToPm(node: MdastNode, schema: Schema, convertChildren) {
    const table = node as MdastTable;
    const align = table.align || [];
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
        // Ensure at least one paragraph in cell
        const content =
          cellContent.length > 0
            ? cellContent
            : [schema.nodes.paragraph.create()];

        const cellAttrs = {
          colspan: 1,
          rowspan: 1,
          alignment: align[colIndex] || null,
        };

        if (rowIndex === 0) {
          cells.push(schema.nodes.tableHeader.create(cellAttrs, content));
        } else {
          cells.push(schema.nodes.tableCell.create(cellAttrs, content));
        }
      });

      rows.push(schema.nodes.tableRow.create(null, cells));
    });

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
    const grid: (null | { cell: PmNode; isMain: boolean })[][] = [];
    for (let r = 0; r < rowCount; r++) {
      grid.push(new Array(maxCols).fill(null));
    }

    // Step 3: Fill grid from PM cells, respecting colspan + rowspan
    node.forEach((row, _offset, rowIndex) => {
      let gridCol = 0;
      row.forEach((cell) => {
        // Skip past already-filled cells (from rowspan above)
        while (gridCol < maxCols && grid[rowIndex][gridCol] !== null) {
          gridCol++;
        }
        const cs = (cell.attrs.colspan as number) || 1;
        const rs = (cell.attrs.rowspan as number) || 1;
        for (let dr = 0; dr < rs; dr++) {
          for (let dc = 0; dc < cs; dc++) {
            if (rowIndex + dr < rowCount && gridCol + dc < maxCols) {
              grid[rowIndex + dr][gridCol + dc] = {
                cell,
                isMain: dr === 0 && dc === 0,
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
        } else {
          // Spanned or empty cell — emit empty content
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
