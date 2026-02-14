// table-transformer.ts — §5.5 GFM Table mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode } from "mdast";
import type { NodeTransformerEntry } from "../types";

interface MdastTable extends MdastNode {
  type: "table";
  align?: (string | null)[];
  children: MdastTableRow[];
}

interface MdastTableRow extends MdastNode {
  type: "tableRow";
  children: MdastTableCell[];
}

interface MdastTableCell extends MdastNode {
  type: "tableCell";
  children: MdastNode[];
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
        const cellChildren = (cell as unknown as { children: MdastNode[] }).children || [];
        const cellContent = cellChildren.length > 0
          ? convertChildren({ children: cellChildren } as unknown as import("mdast").Parent)
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
    const rows: MdastTableRow[] = [];
    const align: (string | null)[] = [];
    let alignCollected = false;

    node.forEach((row) => {
      const cells: MdastTableCell[] = [];

      row.forEach((cell) => {
        const children = convertChildren(cell);
        // Flatten: if single paragraph, use its children directly
        const cellChildren =
          children.length === 1 && children[0].type === "paragraph"
            ? (children[0] as unknown as { children: MdastNode[] }).children
            : children;

        cells.push({
          type: "tableCell",
          children: cellChildren.length > 0 ? cellChildren : [],
        } as MdastTableCell);

        if (!alignCollected) {
          align.push((cell.attrs.alignment as string) || null);
        }
      });

      alignCollected = true;
      rows.push({
        type: "tableRow",
        children: cells,
      } as MdastTableRow);
    });

    return {
      type: "table",
      align: align.some((a) => a !== null) ? align : undefined,
      children: rows,
    } as unknown as MdastNode;
  },
};
