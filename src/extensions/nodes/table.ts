// §5.5 Table Extension — GFM pipe tables
// Uses @tiptap/extension-table as base with custom configuration
import { mergeAttributes } from "@tiptap/core";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import { TextSelection } from "@tiptap/pm/state";

import { resolveShortcut } from "../utils/shortcut-resolver";
import { createVirtualScrollPlugin } from "./plugins/table-virtual-scroll";

// §5.5 Tier 3: Table.extend() with resizable columns + pipe-input auto creation
export const BaramTable = Table.extend({
  renderHTML({ HTMLAttributes }) {
    return [
      "table",
      mergeAttributes(HTMLAttributes, { spellcheck: "false" }),
      ["tbody", 0],
    ];
  },

  addProseMirrorPlugins() {
    return [...(this.parent?.() || []), createVirtualScrollPlugin()];
  },

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // §5.5 M10: Merge or split cells (Cmd+M)
      [resolveShortcut("formatting.tableMerge", "Mod-m")]: () =>
        this.editor.commands.mergeOrSplit(),
      // §5.5 Tier 3: Markdown pipe input auto table creation
      // `| Header 1 | Header 2 |` + Enter → auto-create table
      Enter: () => {
        const { state, view } = this.editor;
        const { $from } = state.selection;

        // Only trigger in a top-level paragraph (not inside table/other blocks)
        if ($from.parent.type.name !== "paragraph") return false;
        if ($from.depth > 1) return false;

        const text = $from.parent.textContent;

        // Match pipe table pattern: starts with | and ends with |
        const match = text.match(/^\|(.+\|)+\s*$/);
        if (!match) return false;

        // Parse headers: split by |, trim, filter empty
        const headers = text
          .split("|")
          .map((s) => s.trim())
          .filter(Boolean);
        if (headers.length < 2) return false;

        // Build table node programmatically in a single transaction
        const { schema } = state;
        const headerCells = headers.map((h) =>
          schema.nodes.tableHeader.create(
            null,
            schema.nodes.paragraph.create(null, h ? [schema.text(h)] : []),
          ),
        );
        const bodyCells = headers.map(() =>
          schema.nodes.tableCell.create(null, schema.nodes.paragraph.create()),
        );
        const tableNode = schema.nodes.table.create(null, [
          schema.nodes.tableRow.create(null, headerCells),
          schema.nodes.tableRow.create(null, bodyCells),
        ]);

        // Replace the paragraph with the table in a single transaction
        const paragraphPos = $from.before($from.depth);
        const paragraphEnd = $from.after($from.depth);
        const { tr } = state;
        tr.replaceWith(paragraphPos, paragraphEnd, tableNode);

        // Place cursor in first body cell (second row, first cell)
        const headerRow = tableNode.child(0);
        const cursorPos = paragraphPos + 1 + headerRow.nodeSize + 1 + 1;
        tr.setSelection(TextSelection.create(tr.doc, cursorPos));

        view.dispatch(tr);
        return true;
      },
    };
  },
}).configure({
  resizable: true, // §5.5 Tier 3: column width drag resize (session only)
  handleWidth: 10, // wider detection zone (default 5 is too narrow with border-collapse)
  lastColumnResizable: true,
  allowTableNodeSelection: true,
});

export const BaramTableRow = TableRow.extend({
  // Default TableRow is fine for our needs
});

export const BaramTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      alignment: { default: null },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const align = node.attrs.alignment as null | string;
    const colspan = node.attrs.colspan as number;
    const rowspan = node.attrs.rowspan as number;
    return [
      "td",
      mergeAttributes(
        HTMLAttributes,
        align ? { style: `text-align: ${align}` } : {},
        colspan > 1 ? { colspan } : {},
        rowspan > 1 ? { rowspan } : {},
      ),
      0,
    ];
  },
});

export const BaramTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      alignment: { default: null },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const align = node.attrs.alignment as null | string;
    const colspan = node.attrs.colspan as number;
    const rowspan = node.attrs.rowspan as number;
    return [
      "th",
      mergeAttributes(
        HTMLAttributes,
        align ? { style: `text-align: ${align}` } : {},
        colspan > 1 ? { colspan } : {},
        rowspan > 1 ? { rowspan } : {},
      ),
      0,
    ];
  },
});
