// §4.8 Block Handle — drag handle + menu on block hover
import { useState, useCallback, useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";

interface BlockHandleProps {
  editor: Editor;
}

interface HandlePosition {
  top: number;
  pos: number;
}

interface DropdownItem {
  label: string;
  action: () => void;
  separator?: boolean;
}

export function BlockHandle({ editor }: BlockHandleProps) {
  const [handle, setHandle] = useState<HandlePosition | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Track which block the mouse is hovering over
  useEffect(() => {
    const editorDom = editor.view.dom;

    const handleMouseMove = (e: MouseEvent) => {
      if (menuOpen) return;

      const editorRect = editorDom.getBoundingClientRect();
      // Only show when mouse is near the left margin
      if (e.clientX > editorRect.left + 60) {
        setHandle(null);
        return;
      }

      // Find the block-level node under the cursor
      try {
        const pos = editor.view.posAtCoords({ left: editorRect.left + 80, top: e.clientY });
        if (!pos) {
          setHandle(null);
          return;
        }

        const resolved = editor.state.doc.resolve(pos.pos);
        if (resolved.depth < 1) {
          setHandle(null);
          return;
        }
        const blockPos = resolved.before(1);
        const dom = editor.view.nodeDOM(blockPos);
        if (!dom || !(dom instanceof HTMLElement)) {
          setHandle(null);
          return;
        }

        const domRect = dom.getBoundingClientRect();
        setHandle({ top: domRect.top, pos: blockPos });
      } catch {
        setHandle(null);
      }
    };

    const handleMouseLeave = () => {
      if (!menuOpen) setHandle(null);
    };

    editorDom.addEventListener("mousemove", handleMouseMove);
    editorDom.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      editorDom.removeEventListener("mousemove", handleMouseMove);
      editorDom.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [editor, menuOpen]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  const handleMenuAction = useCallback(
    (action: () => void) => {
      action();
      setMenuOpen(false);
    },
    [],
  );

  if (!handle) return null;

  const menuItems: DropdownItem[] = [
    {
      label: "Duplicate",
      action: () => {
        if (handle) {
          const node = editor.state.doc.nodeAt(handle.pos);
          if (node) {
            const endPos = handle.pos + node.nodeSize;
            editor
              .chain()
              .focus()
              .insertContentAt(endPos, node.toJSON())
              .run();
          }
        }
      },
    },
    {
      label: "Delete",
      action: () => {
        if (handle) {
          const node = editor.state.doc.nodeAt(handle.pos);
          if (node) {
            editor
              .chain()
              .focus()
              .deleteRange({ from: handle.pos, to: handle.pos + node.nodeSize })
              .run();
          }
        }
      },
    },
    {
      label: "Move Up",
      separator: true,
      action: () => {
        if (handle && handle.pos > 0) {
          const node = editor.state.doc.nodeAt(handle.pos);
          const prevResolved = editor.state.doc.resolve(handle.pos);
          if (node && prevResolved.nodeBefore) {
            const prevPos = handle.pos - prevResolved.nodeBefore.nodeSize;
            editor.chain().focus()
              .deleteRange({ from: handle.pos, to: handle.pos + node.nodeSize })
              .insertContentAt(prevPos, node.toJSON())
              .run();
          }
        }
      },
    },
    {
      label: "Move Down",
      action: () => {
        if (handle) {
          const node = editor.state.doc.nodeAt(handle.pos);
          if (node) {
            const endPos = handle.pos + node.nodeSize;
            const nextNode = editor.state.doc.nodeAt(endPos);
            if (nextNode) {
              const newPos = endPos + nextNode.nodeSize;
              editor.chain().focus()
                .deleteRange({ from: handle.pos, to: endPos })
                .insertContentAt(newPos - node.nodeSize, node.toJSON())
                .run();
            }
          }
        }
      },
    },
  ];

  const editorRect = editor.view.dom.getBoundingClientRect();

  return (
    <>
      <div
        className="block-handle"
        style={{
          top: `${handle.top}px`,
          left: `${editorRect.left - 30}px`,
        }}
      >
        <button
          className="block-handle-btn"
          title="Click for menu"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {"\u22EE"}
        </button>
      </div>

      {menuOpen && (
        <div
          ref={menuRef}
          className="block-handle-menu"
          style={{
            top: `${handle.top}px`,
            left: `${editorRect.left - 24}px`,
          }}
        >
          {menuItems.map((item, i) => (
            <div key={i}>
              {item.separator && <div className="block-handle-separator" />}
              <button
                className="block-handle-menu-item"
                onClick={() => handleMenuAction(item.action)}
              >
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
