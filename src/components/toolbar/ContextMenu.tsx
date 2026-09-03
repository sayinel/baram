import { useCallback, useEffect, useState } from "react";

import type { MenuItem } from "./context-menu-types";
import type { Editor } from "@tiptap/react";

import {
  addBlockId,
  copyBlockId,
  editBlockId,
  removeBlockId,
} from "../../extensions/plugins/block-id-decoration";
// §4.8 Context Menu — right-click with node-type detection
import { chainWithVimExternalEdit } from "../../extensions/plugins/vim/vim-keys";
import { buildMathBlockMenu, buildMathInlineMenu } from "./context-menu-math";
import { buildTableMenu } from "./context-menu-table";
import { MenuList } from "./MenuList";

interface ContextMenuProps {
  editor: Editor;
}

export function ContextMenu({ editor }: ContextMenuProps) {
  const [position, setPosition] = useState<null | { x: number; y: number }>(
    null,
  );
  const [items, setItems] = useState<MenuItem[]>([]);

  const closeMenu = useCallback(() => setPosition(null), []);

  // Detect special node from DOM element at click position
  // Uses Element (not HTMLElement) so SVG child elements inside NodeViews are handled
  //
  // issue 521: mermaidBlock is deliberately NOT here. The mermaid NodeView
  // owns its own right-click menu (MermaidBlockContextMenu); the copy this
  // component used to build was unreachable in preview state (the view stops
  // propagation) and, in editing state, drew a diagram menu over the textarea
  // with a Copy-as-PNG that handed rendered SVG to a mermaid-source function.
  const findSpecialNode = useCallback(
    (target: EventTarget | null) => {
      if (!target || !(target instanceof Element)) return null;

      // Walk up from clicked element to find a node view wrapper
      let el: Element | null = target;
      while (el && el !== editor.view.dom) {
        const dataType =
          el.getAttribute("data-type") ||
          el.closest("[data-type]")?.getAttribute("data-type");
        if (dataType === "mathBlock" || dataType === "mathInline") {
          return dataType;
        }
        el = el.parentElement;
      }
      return null;
    },
    [editor],
  );

  // Build menu items based on the node type at the click position
  const buildMenuItems = useCallback(
    (pos: number): MenuItem[] => {
      const resolved = editor.state.doc.resolve(pos);
      const node = resolved.parent;
      const baseItems: MenuItem[] = [
        {
          label: "Cut",
          action: () => {
            document.execCommand("cut");
          },
        },
        {
          label: "Copy",
          action: () => {
            document.execCommand("copy");
          },
        },
        {
          label: "Paste",
          action: () => {
            document.execCommand("paste");
          },
        },
      ];

      // Table-specific items
      const tableMenu = buildTableMenu(editor, resolved, baseItems);
      if (tableMenu) return tableMenu;

      // Math block items
      if (node.type.name === "mathBlock") {
        return buildMathBlockMenu(editor, pos);
      }

      // Code block items
      if (node.type.name === "codeBlock") {
        return [
          ...baseItems,
          { label: "", action: () => {}, separator: true },
          {
            label: "Select All in Block",
            action: () => {
              const blockPos = resolved.before();
              const blockNode = editor.state.doc.nodeAt(blockPos);
              if (blockNode) {
                editor.commands.setTextSelection({
                  from: blockPos + 1,
                  to: blockPos + blockNode.nodeSize - 1,
                });
              }
            },
          },
        ];
      }

      // Block ID items for paragraph/heading
      const blockIdItems: MenuItem[] = [];
      if (node.type.name === "paragraph" || node.type.name === "heading") {
        const blockPos = resolved.before();
        const blockNode = editor.state.doc.nodeAt(blockPos);
        if (blockNode) {
          const existingId = blockNode.attrs.blockId as null | string;
          blockIdItems.push({ label: "", action: () => {}, separator: true });
          if (existingId) {
            blockIdItems.push(
              {
                label: `Edit Block ID (^${existingId})`,
                action: () => editBlockId(editor.view, blockPos),
              },
              {
                label: "Copy Block ID",
                action: () => copyBlockId(existingId),
              },
              {
                label: "Remove Block ID",
                action: () => removeBlockId(editor.view, blockPos),
              },
            );
          } else {
            blockIdItems.push({
              label: "Add Block ID",
              action: () => addBlockId(editor.view, blockPos),
            });
          }
        }
      }

      // General text context menu — format options
      return [
        ...baseItems,
        { label: "", action: () => {}, separator: true },
        {
          label: "Bold",
          action: () =>
            chainWithVimExternalEdit(editor).focus().toggleBold().run(),
        },
        {
          label: "Italic",
          action: () =>
            chainWithVimExternalEdit(editor).focus().toggleItalic().run(),
        },
        {
          label: "Strikethrough",
          action: () =>
            chainWithVimExternalEdit(editor).focus().toggleStrike().run(),
        },
        {
          label: "Inline Code",
          action: () =>
            chainWithVimExternalEdit(editor).focus().toggleCode().run(),
        },
        ...blockIdItems,
      ];
    },
    [editor],
  );

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // Only handle right-click inside the editor
      if (!editor.view.dom.contains(e.target as Node)) return;

      // Check for special nodes via DOM detection (needed for atom nodes)
      const specialType = findSpecialNode(e.target);

      // issue 521: a right-click on a native text control inside a NodeView
      // — the mermaid/svg textarea while editing, a query-builder <select>,
      // the frontmatter tag input — is the browser's to handle (copy, paste,
      // spellcheck). posAtCoords cannot map such a click to a document
      // position (it lands on the atom's edge, or nowhere), so the generic
      // menu would act on the wrong selection. Decided AFTER special-node
      // detection, so the math menus keep their textarea behaviour
      // unchanged, and BEFORE preventDefault, so the native menu actually
      // appears. The rule is deliberately blanket over native text controls
      // in the editor (every NodeView textarea, caption and title inputs,
      // the query builder's selects, the code block's language select):
      // for all of them the document menu acted on the ProseMirror
      // selection, not on the control. Checkboxes and radios are excluded in
      // advance — none exist in the editor today (the task item's control is
      // a <button>, unaffected either way). closeMenu(): a mouse right-click
      // never arrives with our menu open, since MenuList closes on the
      // preceding mousedown, but a keyboard-invoked context menu (Shift+F10,
      // the Menu key) has no mousedown, and the old menu must not linger
      // beside the native one.
      if (
        specialType === null &&
        e.target instanceof Element &&
        e.target.closest(
          'textarea, select, input:not([type="checkbox"]):not([type="radio"])',
        ) !== null
      ) {
        closeMenu();
        return;
      }

      e.preventDefault();

      if (specialType === "mathInline") {
        setItems(buildMathInlineMenu(editor, e.target as HTMLElement));
        setPosition({ x: e.clientX, y: e.clientY });
        return;
      }

      const pos = editor.view.posAtCoords({
        left: e.clientX,
        top: e.clientY,
      });
      if (!pos) return;

      if (specialType === "mathBlock") {
        setItems(buildMathBlockMenu(editor, pos.pos));
      } else {
        setItems(buildMenuItems(pos.pos));
      }
      setPosition({ x: e.clientX, y: e.clientY });
    };

    document.addEventListener("contextmenu", handleContextMenu);

    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, [editor, buildMenuItems, findSpecialNode, closeMenu]);

  if (!position) return null;

  return (
    <MenuList items={items} onClose={closeMenu} x={position.x} y={position.y} />
  );
}
