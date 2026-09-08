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
import { useTranslation } from "../../i18n/useTranslation";
import { closeAllContextMenus } from "../../utils/editor/context-menu-exclusive";
import {
  isInNativeSelect,
  isInNativeTextControl,
} from "../../utils/editor/native-text-control";
import { buildMathBlockMenu, buildMathInlineMenu } from "./context-menu-math";
import { buildTableMenu } from "./context-menu-table";
import { MenuList } from "./MenuList";

interface ContextMenuProps {
  editor: Editor;
}

export function ContextMenu({ editor }: ContextMenuProps) {
  const { t } = useTranslation();
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
          label: t("menu.edit.cut"),
          action: () => {
            document.execCommand("cut");
          },
        },
        {
          label: t("menu.edit.copy"),
          action: () => {
            document.execCommand("copy");
          },
        },
        {
          label: t("menu.edit.paste"),
          action: () => {
            document.execCommand("paste");
          },
        },
      ];

      // Table-specific items
      const tableMenu = buildTableMenu(editor, resolved, baseItems, t);
      if (tableMenu) return tableMenu;

      // Math block items
      if (node.type.name === "mathBlock") {
        return buildMathBlockMenu(editor, pos, t);
      }

      // Code block items
      if (node.type.name === "codeBlock") {
        return [
          ...baseItems,
          { label: "", action: () => {}, separator: true },
          {
            label: t("contextMenu.selectAllInBlock"),
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
                label: t("blockId.edit", { id: existingId }),
                action: () => editBlockId(editor.view, blockPos),
              },
              {
                label: t("blockId.copy"),
                action: () => copyBlockId(existingId),
              },
              {
                label: t("blockId.remove"),
                action: () => removeBlockId(editor.view, blockPos),
              },
            );
          } else {
            blockIdItems.push({
              label: t("blockId.add"),
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
          label: t("menu.insert.bold"),
          action: () =>
            chainWithVimExternalEdit(editor).focus().toggleBold().run(),
        },
        {
          label: t("menu.insert.italic"),
          action: () =>
            chainWithVimExternalEdit(editor).focus().toggleItalic().run(),
        },
        {
          label: t("menu.insert.strikethrough"),
          action: () =>
            chainWithVimExternalEdit(editor).focus().toggleStrike().run(),
        },
        {
          label: t("menu.insert.inlineCode"),
          action: () =>
            chainWithVimExternalEdit(editor).focus().toggleCode().run(),
        },
        ...blockIdItems,
      ];
    },
    [editor, t],
  );

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // Only handle right-click inside the editor
      if (!editor.view.dom.contains(e.target as Node)) return;

      // Check for special nodes via DOM detection (needed for atom nodes)
      const specialType = findSpecialNode(e.target);

      // issue 521: a right-click on a native text control is the browser's
      // (copy, paste, select all) — posAtCoords cannot map it to a document
      // position, so our menu would act on the wrong selection. Decided
      // AFTER special-node detection (the math menus keep their textarea)
      // and BEFORE preventDefault (so the native menu appears). Which
      // controls that covers, and why the NodeViews share the predicate, is
      // documented in native-text-control.ts. Every menu of ours closes
      // first: a mousedown dismiss may not have run (keyboard-invoked, or a
      // NodeView stopped the right-button one).
      if (specialType === null && isInNativeSelect(e.target)) {
        // No menu at all for a <select> — see native-text-control.ts.
        closeAllContextMenus();
        e.preventDefault();
        return;
      }
      if (specialType === null && isInNativeTextControl(e.target)) {
        closeAllContextMenus();
        return;
      }

      e.preventDefault();
      // One menu at a time: a block menu may still be open (its dismiss
      // never saw a mousedown that a NodeView stopped, or there was none —
      // keyboard-invoked). context-menu-exclusive.ts.
      closeAllContextMenus();

      if (specialType === "mathInline") {
        setItems(buildMathInlineMenu(editor, e.target as HTMLElement, t));
        setPosition({ x: e.clientX, y: e.clientY });
        return;
      }

      const pos = editor.view.posAtCoords({
        left: e.clientX,
        top: e.clientY,
      });
      if (!pos) return;

      if (specialType === "mathBlock") {
        setItems(buildMathBlockMenu(editor, pos.pos, t));
      } else {
        setItems(buildMenuItems(pos.pos));
      }
      setPosition({ x: e.clientX, y: e.clientY });
    };

    document.addEventListener("contextmenu", handleContextMenu);

    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, [editor, buildMenuItems, findSpecialNode, t]);

  if (!position) return null;

  return (
    <MenuList items={items} onClose={closeMenu} x={position.x} y={position.y} />
  );
}
