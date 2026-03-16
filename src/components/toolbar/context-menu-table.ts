import type { MenuItem } from "./context-menu-types";
// §4.8 Context Menu — table menu builder
import type { Editor } from "@tiptap/react";

import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";

/**
 * Build context menu items for a table cell, prepended with `baseItems`.
 * Returns null if the resolved position is not inside a table cell.
 */
export function buildTableMenu(
  editor: Editor,
  resolved: ReturnType<typeof editor.state.doc.resolve>,
  baseItems: MenuItem[],
): MenuItem[] | null {
  // Walk up from resolved pos to find cell
  let tableCell = null;
  for (let d = resolved.depth; d >= 0; d--) {
    const n = resolved.node(d);
    if (n.type.name === "tableCell" || n.type.name === "tableHeader") {
      tableCell = n;
      break;
    }
  }
  if (!tableCell) return null;

  const currentAlign = (tableCell.attrs.alignment as null | string) ?? null;

  return [
    ...baseItems,
    { label: "", action: () => {}, separator: true },
    {
      label: "Add Row Above",
      action: () => editor.chain().focus().addRowBefore().run(),
    },
    {
      label: "Add Row Below",
      action: () => editor.chain().focus().addRowAfter().run(),
    },
    {
      label: "Add Column Left",
      action: () => editor.chain().focus().addColumnBefore().run(),
    },
    {
      label: "Add Column Right",
      action: () => editor.chain().focus().addColumnAfter().run(),
    },
    { label: "", action: () => {}, separator: true },
    {
      label: `Align Left${currentAlign === "left" ? " \u2713" : ""}`,
      action: () =>
        editor.chain().focus().setCellAttribute("alignment", "left").run(),
    },
    {
      label: `Align Center${currentAlign === "center" ? " \u2713" : ""}`,
      action: () =>
        editor.chain().focus().setCellAttribute("alignment", "center").run(),
    },
    {
      label: `Align Right${currentAlign === "right" ? " \u2713" : ""}`,
      action: () =>
        editor.chain().focus().setCellAttribute("alignment", "right").run(),
    },
    {
      label: `No Alignment${currentAlign === null ? " \u2713" : ""}`,
      action: () =>
        editor.chain().focus().setCellAttribute("alignment", null).run(),
    },
    ...(editor.can().mergeCells() || editor.can().splitCell()
      ? [{ label: "", action: () => {}, separator: true }]
      : []),
    ...(editor.can().mergeCells()
      ? [
          {
            label: "Merge Cells",
            action: () => editor.chain().focus().mergeCells().run(),
          },
        ]
      : []),
    ...(editor.can().splitCell()
      ? [
          {
            label: "Split Cell",
            action: () => editor.chain().focus().splitCell().run(),
          },
        ]
      : []),
    { label: "", action: () => {}, separator: true },
    {
      label: "Delete Row",
      action: () => editor.chain().focus().deleteRow().run(),
    },
    {
      label: "Delete Column",
      action: () => editor.chain().focus().deleteColumn().run(),
    },
    {
      label: "Delete Table",
      action: () => editor.chain().focus().deleteTable().run(),
    },
    { label: "", action: () => {}, separator: true },
    {
      label: "Toggle Header Row",
      action: () => editor.chain().focus().toggleHeaderRow().run(),
    },
    {
      label: "Toggle Header Column",
      action: () => editor.chain().focus().toggleHeaderColumn().run(),
    },
    {
      label: "Copy as Markdown",
      action: () => {
        const table = findTableAtCursor(editor);
        if (!table || !table.node) return;
        const tempDoc = editor.schema.nodes.doc.create(null, [table.node]);
        const md = prosemirrorToMarkdown(tempDoc);
        navigator.clipboard.writeText(md.trim());
      },
    },
    {
      label: "Copy as HTML",
      action: () => {
        const table = findTableAtCursor(editor);
        if (!table) return;
        const dom = editor.view.nodeDOM(table.pos);
        if (dom && dom instanceof HTMLElement) {
          navigator.clipboard.writeText(dom.outerHTML);
        }
      },
    },
  ];
}

/** Walk up from resolved position to find the enclosing table node. */
export function findTableAtCursor(editor: Editor): null | {
  depth: number;
  node: ReturnType<typeof editor.state.doc.nodeAt>;
  pos: number;
} {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "table") {
      return { node, pos: $from.before(d), depth: d };
    }
  }
  return null;
}
