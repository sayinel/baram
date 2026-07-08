// §4.8 Context Menu — right-click with node-type detection
import { useCallback, useEffect, useState } from "react";

import type { MenuItem } from "./context-menu-types";
import type { Editor } from "@tiptap/react";

import {
  addBlockId,
  copyBlockId,
  editBlockId,
  removeBlockId,
} from "../../extensions/plugins/block-id-decoration";
import { buildMathBlockMenu, buildMathInlineMenu } from "./context-menu-math";
import { buildMermaidBlockMenu } from "./context-menu-mermaid";
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
  const findSpecialNode = useCallback(
    (target: EventTarget | null) => {
      if (!target || !(target instanceof Element)) return null;

      // Walk up from clicked element to find a node view wrapper
      let el: Element | null = target;
      while (el && el !== editor.view.dom) {
        const dataType =
          el.getAttribute("data-type") ||
          el.closest("[data-type]")?.getAttribute("data-type");
        if (
          dataType === "mathBlock" ||
          dataType === "mathInline" ||
          dataType === "mermaidBlock"
        ) {
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
          action: () => editor.chain().focus().toggleBold().run(),
        },
        {
          label: "Italic",
          action: () => editor.chain().focus().toggleItalic().run(),
        },
        {
          label: "Strikethrough",
          action: () => editor.chain().focus().toggleStrike().run(),
        },
        {
          label: "Inline Code",
          action: () => editor.chain().focus().toggleCode().run(),
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

      e.preventDefault();

      // Check for special nodes via DOM detection (needed for atom nodes)
      const specialType = findSpecialNode(e.target);

      if (specialType === "mathInline") {
        setItems(buildMathInlineMenu(editor, e.target as HTMLElement));
        setPosition({ x: e.clientX, y: e.clientY });
        return;
      }

      if (specialType === "mermaidBlock") {
        setItems(buildMermaidBlockMenu(editor, e.target as Element));
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
  }, [editor, buildMenuItems, findSpecialNode]);

  if (!position) return null;

  return (
    <MenuList items={items} onClose={closeMenu} x={position.x} y={position.y} />
  );
}
