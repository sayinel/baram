import type { Translate } from "../../i18n/useTranslation";
import type { MenuItem } from "./context-menu-types";
// §4.8 Context Menu — table menu builder
import type { Editor } from "@tiptap/react";

import { chainWithVimExternalEdit } from "../../extensions/plugins/vim/vim-keys";
import {
  canonicalNodeAt,
  serializeDetachedDoc,
} from "../../utils/editor/serialize-live-doc";

/**
 * Build context menu items for a table cell, prepended with `baseItems`.
 * Returns null if the resolved position is not inside a table cell.
 *
 * ‼️ `t` is a parameter, not a module-level import: `MenuItem.label` is what MenuList paints,
 * so the label has to be resolved here, and a locale-bound `t` only exists inside a component.
 */
export function buildTableMenu(
  editor: Editor,
  resolved: ReturnType<typeof editor.state.doc.resolve>,
  baseItems: MenuItem[],
  t: Translate,
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
      label: t("tableMenu.addRowAbove"),
      action: () =>
        chainWithVimExternalEdit(editor).focus().addRowBefore().run(),
    },
    {
      label: t("tableMenu.addRowBelow"),
      action: () =>
        chainWithVimExternalEdit(editor).focus().addRowAfter().run(),
    },
    {
      label: t("tableMenu.addColumnLeft"),
      action: () =>
        chainWithVimExternalEdit(editor).focus().addColumnBefore().run(),
    },
    {
      label: t("tableMenu.addColumnRight"),
      action: () =>
        chainWithVimExternalEdit(editor).focus().addColumnAfter().run(),
    },
    { label: "", action: () => {}, separator: true },
    {
      label: `${t("tableToolbar.alignLeft")}${currentAlign === "left" ? " \u2713" : ""}`,
      action: () =>
        chainWithVimExternalEdit(editor)
          .focus()
          .setCellAttribute("alignment", "left")
          .run(),
    },
    {
      label: `${t("tableToolbar.alignCenter")}${currentAlign === "center" ? " \u2713" : ""}`,
      action: () =>
        chainWithVimExternalEdit(editor)
          .focus()
          .setCellAttribute("alignment", "center")
          .run(),
    },
    {
      label: `${t("tableToolbar.alignRight")}${currentAlign === "right" ? " \u2713" : ""}`,
      action: () =>
        chainWithVimExternalEdit(editor)
          .focus()
          .setCellAttribute("alignment", "right")
          .run(),
    },
    {
      label: `${t("tableMenu.noAlignment")}${currentAlign === null ? " \u2713" : ""}`,
      action: () =>
        chainWithVimExternalEdit(editor)
          .focus()
          .setCellAttribute("alignment", null)
          .run(),
    },
    ...(editor.can().mergeCells() || editor.can().splitCell()
      ? [{ label: "", action: () => {}, separator: true }]
      : []),
    ...(editor.can().mergeCells()
      ? [
          {
            label: t("keybindings.formatting.tableMerge"),
            action: () =>
              chainWithVimExternalEdit(editor).focus().mergeCells().run(),
          },
        ]
      : []),
    ...(editor.can().splitCell()
      ? [
          {
            label: t("tableToolbar.splitCell"),
            action: () =>
              chainWithVimExternalEdit(editor).focus().splitCell().run(),
          },
        ]
      : []),
    { label: "", action: () => {}, separator: true },
    {
      label: t("tableToolbar.deleteRow"),
      action: () => chainWithVimExternalEdit(editor).focus().deleteRow().run(),
    },
    {
      label: t("tableToolbar.deleteColumn"),
      action: () =>
        chainWithVimExternalEdit(editor).focus().deleteColumn().run(),
    },
    {
      label: t("tableMenu.deleteTable"),
      action: () =>
        chainWithVimExternalEdit(editor).focus().deleteTable().run(),
    },
    { label: "", action: () => {}, separator: true },
    {
      label: t("tableMenu.toggleHeaderRow"),
      action: () =>
        chainWithVimExternalEdit(editor).focus().toggleHeaderRow().run(),
    },
    {
      label: t("tableMenu.toggleHeaderColumn"),
      action: () =>
        chainWithVimExternalEdit(editor).focus().toggleHeaderColumn().run(),
    },
    {
      label: t("tableMenu.copyAsMarkdown"),
      action: () => {
        const table = findTableAtCursor(editor);
        if (!table || !table.node) return;
        // §384: canonicalize first — a mid-expansion mark/link/wikilink inside a
        // cell would otherwise copy its literal delimiter text.
        const canonicalTable = canonicalNodeAt(
          editor.state,
          table.pos,
          "table",
        );
        if (!canonicalTable) return;
        const tempDoc = editor.schema.nodes.doc.create(null, [canonicalTable]);
        const md = serializeDetachedDoc(tempDoc);
        navigator.clipboard.writeText(md.trim());
      },
    },
    {
      label: t("tableMenu.copyAsHtml"),
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

/**
 * The item list for the table toolbar's `⋯` overflow menu (§5.5). These are the
 * lower-frequency commands kept out of the compact primary toolbar row. Rendered
 * by the shared MenuList, same as the right-click context menu.
 */
export function buildTableOverflowItems(
  editor: Editor,
  t: Translate,
): MenuItem[] {
  return [
    {
      label: t("tableMenu.toggleHeaderRow"),
      action: () =>
        chainWithVimExternalEdit(editor).focus().toggleHeaderRow().run(),
    },
    {
      label: t("tableMenu.toggleHeaderColumn"),
      action: () =>
        chainWithVimExternalEdit(editor).focus().toggleHeaderColumn().run(),
    },
    { label: "", action: () => {}, separator: true },
    {
      label: t("tableMenu.copyAsMarkdown"),
      action: () => {
        const table = findTableAtCursor(editor);
        if (!table || !table.node) return;
        // §384: same canonicalization as the context-menu "Copy as Markdown".
        const canonicalTable = canonicalNodeAt(
          editor.state,
          table.pos,
          "table",
        );
        if (!canonicalTable) return;
        const tempDoc = editor.schema.nodes.doc.create(null, [canonicalTable]);
        navigator.clipboard.writeText(serializeDetachedDoc(tempDoc).trim());
      },
    },
    {
      label: t("tableMenu.copyAsHtml"),
      action: () => {
        const table = findTableAtCursor(editor);
        if (!table) return;
        const dom = editor.view.nodeDOM(table.pos);
        if (dom && dom instanceof HTMLElement) {
          navigator.clipboard.writeText(dom.outerHTML);
        }
      },
    },
    { label: "", action: () => {}, separator: true },
    {
      label: t("tableMenu.deleteTable"),
      action: () =>
        chainWithVimExternalEdit(editor).focus().deleteTable().run(),
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
