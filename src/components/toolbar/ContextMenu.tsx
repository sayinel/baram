// §4.8 Context Menu — right-click with node-type detection
import { useState, useEffect, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { copyMathToPNG } from "../../utils/katex-to-png";
import {
  addBlockId,
  editBlockId,
  removeBlockId,
  copyBlockId,
} from "../../extensions/plugins/block-id-decoration";

interface ContextMenuProps {
  editor: Editor;
}

interface MenuItem {
  label: string;
  action: () => void;
  separator?: boolean;
}

export function ContextMenu({ editor }: ContextMenuProps) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [items, setItems] = useState<MenuItem[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setPosition(null), []);

  // Detect math node from DOM element at click position
  const findMathNode = useCallback(
    (target: EventTarget | null) => {
      if (!target || !(target instanceof HTMLElement)) return null;

      // Walk up from clicked element to find a math node view wrapper
      let el: HTMLElement | null = target;
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

  // Build math block context menu
  const buildMathBlockMenu = useCallback(
    (pos: number): MenuItem[] => {
      const resolved = editor.state.doc.resolve(pos);
      // atom:true — find the mathBlock node via nodeAt or nodeAfter
      let mathNode = editor.state.doc.nodeAt(pos);
      let mathPos = pos;
      if (!mathNode || mathNode.type.name !== "mathBlock") {
        mathNode = resolved.nodeAfter;
        mathPos = pos;
      }
      if (!mathNode || mathNode.type.name !== "mathBlock") {
        mathNode = resolved.parent;
        mathPos = resolved.before();
      }

      const formula = (mathNode.attrs.formula as string) || "";
      const currentSize = (mathNode.attrs.mathSize as string) || "normal";

      return [
        {
          label: "Copy LaTeX Source",
          action: () => navigator.clipboard.writeText(formula),
        },
        {
          label: "Copy as Image",
          action: () => { copyMathToPNG(formula, true); },
        },
        { label: "", action: () => {}, separator: true },
        {
          label: `Size: Small${currentSize === "small" ? " \u2713" : ""}`,
          action: () => {
            const tr = editor.state.tr;
            tr.setNodeMarkup(mathPos, undefined, {
              ...mathNode.attrs,
              mathSize: "small",
            });
            editor.view.dispatch(tr);
          },
        },
        {
          label: `Size: Normal${currentSize === "normal" ? " \u2713" : ""}`,
          action: () => {
            const tr = editor.state.tr;
            tr.setNodeMarkup(mathPos, undefined, {
              ...mathNode.attrs,
              mathSize: "normal",
            });
            editor.view.dispatch(tr);
          },
        },
        {
          label: `Size: Large${currentSize === "large" ? " \u2713" : ""}`,
          action: () => {
            const tr = editor.state.tr;
            tr.setNodeMarkup(mathPos, undefined, {
              ...mathNode.attrs,
              mathSize: "large",
            });
            editor.view.dispatch(tr);
          },
        },
        { label: "", action: () => {}, separator: true },
        {
          label: "Convert to Inline Math",
          action: () => {
            const tr = editor.state.tr;
            const mathInlineType = editor.schema.nodes.mathInline;
            if (!mathInlineType) return;
            const inlineNode = mathInlineType.create({ formula });
            tr.replaceWith(mathPos, mathPos + mathNode.nodeSize, inlineNode);
            editor.view.dispatch(tr);
          },
        },
        {
          label: "Delete Equation",
          action: () => {
            const tr = editor.state.tr;
            tr.delete(mathPos, mathPos + mathNode.nodeSize);
            editor.view.dispatch(tr);
          },
        },
      ];
    },
    [editor],
  );

  // Build math inline context menu
  const buildMathInlineMenu = useCallback(
    (target: HTMLElement): MenuItem[] => {
      // Find the inline math node by walking the DOM to get ProseMirror position
      const nodeViewWrapper = target.closest("[data-type='mathInline']") as HTMLElement | null;
      if (!nodeViewWrapper) return [];

      const pmPos = editor.view.posAtDOM(nodeViewWrapper, 0);
      const resolved = editor.state.doc.resolve(pmPos);
      // For atom inline nodes, check nodeAfter at the resolved position
      const inlineNode = resolved.nodeAfter ?? resolved.parent;
      const isInlineAtom = inlineNode.type.name === "mathInline";
      const mathNode = isInlineAtom ? inlineNode : resolved.parent;
      const nodePos = isInlineAtom ? pmPos : resolved.before();

      const formula = (mathNode.attrs.formula as string) || "";
      const currentSize = (mathNode.attrs.mathSize as string) || "normal";

      return [
        {
          label: "Copy LaTeX Source",
          action: () => navigator.clipboard.writeText(formula),
        },
        {
          label: "Copy as Image",
          action: () => { copyMathToPNG(formula, false); },
        },
        { label: "", action: () => {}, separator: true },
        {
          label: `Size: Small${currentSize === "small" ? " \u2713" : ""}`,
          action: () => {
            const tr = editor.state.tr;
            tr.setNodeMarkup(nodePos, undefined, {
              ...mathNode.attrs,
              mathSize: "small",
            });
            editor.view.dispatch(tr);
          },
        },
        {
          label: `Size: Normal${currentSize === "normal" ? " \u2713" : ""}`,
          action: () => {
            const tr = editor.state.tr;
            tr.setNodeMarkup(nodePos, undefined, {
              ...mathNode.attrs,
              mathSize: "normal",
            });
            editor.view.dispatch(tr);
          },
        },
        {
          label: `Size: Large${currentSize === "large" ? " \u2713" : ""}`,
          action: () => {
            const tr = editor.state.tr;
            tr.setNodeMarkup(nodePos, undefined, {
              ...mathNode.attrs,
              mathSize: "large",
            });
            editor.view.dispatch(tr);
          },
        },
        { label: "", action: () => {}, separator: true },
        {
          label: "Convert to Block Math",
          action: () => {
            const tr = editor.state.tr;
            const mathBlockType = editor.schema.nodes.mathBlock;
            if (!mathBlockType) return;
            // atom:true — formula in attrs, no text children
            const blockNode = mathBlockType.create({ formula });
            tr.replaceWith(nodePos, nodePos + mathNode.nodeSize, blockNode);
            editor.view.dispatch(tr);
          },
        },
        {
          label: "Delete Equation",
          action: () => {
            const tr = editor.state.tr;
            tr.delete(nodePos, nodePos + mathNode.nodeSize);
            editor.view.dispatch(tr);
          },
        },
      ];
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
      if (
        node.type.name === "tableCell" ||
        node.type.name === "tableHeader"
      ) {
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
        ];
      }

      // Math block items
      if (node.type.name === "mathBlock") {
        return buildMathBlockMenu(pos);
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
          const existingId = blockNode.attrs.blockId as string | null;
          blockIdItems.push(
            { label: "", action: () => {}, separator: true },
          );
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
    [editor, buildMathBlockMenu],
  );

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // Only handle right-click inside the editor
      if (!editor.view.dom.contains(e.target as Node)) return;

      e.preventDefault();

      // Check for math nodes via DOM detection (needed for atom nodes like mathInline)
      const mathType = findMathNode(e.target);

      if (mathType === "mathInline") {
        setItems(buildMathInlineMenu(e.target as HTMLElement));
        setPosition({ x: e.clientX, y: e.clientY });
        return;
      }

      const pos = editor.view.posAtCoords({
        left: e.clientX,
        top: e.clientY,
      });
      if (!pos) return;

      if (mathType === "mathBlock") {
        setItems(buildMathBlockMenu(pos.pos));
      } else {
        setItems(buildMenuItems(pos.pos));
      }
      setPosition({ x: e.clientX, y: e.clientY });
    };

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };

    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [editor, buildMenuItems, buildMathBlockMenu, buildMathInlineMenu, findMathNode, closeMenu]);

  if (!position) return null;

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="context-menu-separator" />
        ) : (
          <button
            key={i}
            className="context-menu-item"
            onClick={() => {
              item.action();
              closeMenu();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
