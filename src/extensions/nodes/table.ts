// §5.5 Table Extension — GFM pipe tables
// Uses @tiptap/extension-table as base with custom configuration
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";

// Re-configure table extensions with Baram-specific settings

export const BaramTable = Table.configure({
  resizable: false, // §5.5: column width not stored in markdown
  lastColumnResizable: false,
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
});

export const BaramTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      alignment: { default: null },
    };
  },
});
