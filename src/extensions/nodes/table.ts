// §5.5 Table Extension — GFM pipe tables
// Uses @tiptap/extension-table as base with custom configuration
import { mergeAttributes } from "@tiptap/core";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { selectionCell, TableMap } from "@tiptap/pm/tables";

import { resolveShortcut } from "../utils/shortcut-resolver";
import {
  createColResizePlugin,
  createUserResizeTracker,
} from "./plugins/table-col-resize";
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
    // Parent returns [columnResizing, tableEditing] when resizable: true.
    // columnResizing handles the actual drag-to-resize.
    // createColResizePlugin initializes colwidth on tables from markdown.

    // Shift+Enter inside table cell → insert hardBreak.
    // Uses a ProseMirror plugin with handleKeyDown (DOM-level) because
    // Tiptap keyboard shortcuts may not fire for Shift-Enter in WKWebView.
    // Shift+Enter inside table cell → insert hardBreak (line break).
    // WKWebView does NOT fire beforeinput for Shift+Enter, so we use handleKeyDown.
    const shiftEnterPlugin = new Plugin({
      key: new PluginKey("tableShiftEnter"),
      props: {
        handleKeyDown: (view, event) => {
          if (!event.shiftKey || event.key !== "Enter") return false;

          const { $from } = view.state.selection;
          let inCell = false;
          for (let d = $from.depth; d > 0; d--) {
            const name = $from.node(d).type.name;
            if (name === "tableCell" || name === "tableHeader") {
              inCell = true;
              break;
            }
          }
          if (!inCell) return false;

          event.preventDefault();

          const { tr, schema } = view.state;
          tr.replaceSelectionWith(schema.nodes.hardBreak.create(), false);
          view.dispatch(tr.scrollIntoView());
          return true;
        },
      },
    });

    return [
      shiftEnterPlugin, // must be first to intercept before tableEditing
      ...(this.parent?.() || []),
      createColResizePlugin(),
      createUserResizeTracker(),
      createVirtualScrollPlugin(),
    ];
  },

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // Shift+Enter handled via ProseMirror plugin (see addProseMirrorPlugins)
      // §5.5 M10: Merge or split cells (Cmd+M)
      [resolveShortcut("formatting.tableMerge", "Mod-m")]: () =>
        this.editor.commands.mergeOrSplit(),
      // Inside table cell: Enter moves to the cell below (or adds row).
      // Shift+Enter creates a hardBreak (line break) within the cell.
      Enter: () => {
        const { state, view } = this.editor;
        const { $from } = state.selection;

        // Check if cursor is inside a table cell → move DOWN to the cell below
        for (let d = $from.depth; d > 0; d--) {
          const nodeType = $from.node(d).type.name;
          if (nodeType === "tableCell" || nodeType === "tableHeader") {
            // Find the cell below using TableMap
            const $cell = selectionCell(state);
            if (!$cell) return false;
            const table = $cell.node(-1);
            const tableStart = $cell.start(-1);
            const map = TableMap.get(table);
            const cellPos = $cell.pos - tableStart;
            const cellIndex = map.map.indexOf(cellPos);
            if (cellIndex === -1) return false;
            const col = cellIndex % map.width;
            const row = Math.floor(cellIndex / map.width);

            if (row + 1 < map.height) {
              // Move to cell below
              const belowCellPos =
                tableStart + map.map[(row + 1) * map.width + col];
              const $below = state.doc.resolve(belowCellPos);
              view.dispatch(
                state.tr
                  .setSelection(TextSelection.near($below, 1))
                  .scrollIntoView(),
              );
              return true;
            }
            // At last row — add a new row and move into it
            return this.editor.chain().addRowAfter().goToNextCell().run();
          }
        }

        // §5.5 Tier 3: Markdown pipe input auto table creation
        // `| Header 1 | Header 2 |` + Enter → auto-create table
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
  resizable: true, // §5.5 Tier 3: columnResizing + TableView (colgroup)
  handleWidth: 10, // wider detection zone (default 5 is too narrow with border-collapse)
  lastColumnResizable: true,
  allowTableNodeSelection: true,
});

export const BaramTableRow = TableRow.extend({
  // Default TableRow is fine for our needs
});

export const BaramTableCell = TableCell.extend({
  // Restrict to paragraphs only — prevents lists, blockquotes, headings inside cells.
  // Line breaks within a cell use hardBreak (Shift+Enter).
  content: "paragraph+",

  addAttributes() {
    return {
      ...this.parent?.(),
      alignment: { default: null },
      userResized: { default: false, rendered: false },
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
  content: "paragraph+",

  addAttributes() {
    return {
      ...this.parent?.(),
      alignment: { default: null },
      userResized: { default: false, rendered: false },
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
