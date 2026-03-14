// §4.8 Block Handle — drag handle + menu on block hover
// §11.2.3 BlockHandle AI submenu — contextual AI actions per block type
import { useCallback, useEffect, useRef, useState } from "react";

import type { Editor } from "@tiptap/react";

import {
  addBlockId,
  editBlockId,
} from "../../extensions/plugins/block-id-decoration";
import {
  dispatchAIAction,
  dispatchCustomInstruction,
} from "../../utils/ai-action-dispatcher";
import {
  getBlockContentMode,
  getBlockTextContent,
} from "../../utils/block-ai-utils";
import { getActionsForMode } from "../../utils/contextual-ai-actions";

interface BlockHandleProps {
  editor: Editor;
}

interface DropdownItem {
  action: () => void;
  label: string;
  separator?: boolean;
}

interface HandlePosition {
  pos: number;
  top: number;
}

export function BlockHandle({ editor }: BlockHandleProps) {
  const [handle, setHandle] = useState<HandlePosition | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [aiSubOpen, setAiSubOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const aiSubRef = useRef<HTMLDivElement>(null);

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
        const pos = editor.view.posAtCoords({
          left: editorRect.left + 80,
          top: e.clientY,
        });
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

  // Reset handle when document changes (e.g. tab switch, wikilink navigation)
  useEffect(() => {
    const handler = () => {
      setHandle(null);
      setMenuOpen(false);
      setAiSubOpen(false);
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setAiSubOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  // Reposition AI submenu to avoid going off-screen
  useEffect(() => {
    if (!aiSubOpen || !aiSubRef.current || !menuRef.current) return;
    const menuRect = menuRef.current.getBoundingClientRect();
    const subRect = aiSubRef.current.getBoundingClientRect();
    // If submenu goes off right edge, flip to left side
    if (menuRect.right + subRect.width > window.innerWidth - 8) {
      aiSubRef.current.style.left = "auto";
      aiSubRef.current.style.right = "100%";
    }
    // If submenu goes off bottom edge, align to bottom of parent
    if (subRect.bottom > window.innerHeight - 8) {
      const overflow = subRect.bottom - window.innerHeight + 8;
      aiSubRef.current.style.marginTop = `-${overflow}px`;
    }
  }, [aiSubOpen]);

  const handleMenuAction = useCallback((action: () => void) => {
    action();
    setMenuOpen(false);
    setAiSubOpen(false);
  }, []);

  const handleAIAction = useCallback(
    (action: Parameters<typeof dispatchAIAction>[0]) => {
      if (!handle) return;
      setMenuOpen(false);
      setAiSubOpen(false);
      dispatchAIAction(action, editor, handle.pos);
    },
    [editor, handle],
  );

  const handleCustomInstruction = useCallback(() => {
    if (!handle) return;
    setMenuOpen(false);
    setAiSubOpen(false);
    dispatchCustomInstruction(editor, handle.pos);
  }, [editor, handle]);

  if (!handle) return null;

  // Guard: stale position after document change
  if (handle.pos >= editor.state.doc.content.size) return null;

  // Determine AI actions for the current block
  const currentNode = editor.state.doc.nodeAt(handle.pos);
  const aiMode = currentNode ? getBlockContentMode(currentNode) : null;
  const aiActions = aiMode ? getActionsForMode(aiMode) : [];
  const blockHasContent = currentNode
    ? getBlockTextContent(currentNode).trim().length > 0
    : false;

  // Build block ID menu item for paragraph/heading nodes
  const blockIdItem: DropdownItem | null = (() => {
    if (!handle) return null;
    const node = editor.state.doc.nodeAt(handle.pos);
    if (!node) return null;
    if (node.type.name !== "paragraph" && node.type.name !== "heading")
      return null;
    const existingId = node.attrs.blockId as null | string;
    if (existingId) {
      return {
        label: `Edit Block ID (^${existingId})`,
        separator: true,
        action: () => {
          editBlockId(editor.view, handle.pos);
          setMenuOpen(false);
        },
      };
    }
    return {
      label: "Add Block ID",
      separator: true,
      action: () => {
        addBlockId(editor.view, handle.pos);
      },
    };
  })();

  const menuItems: DropdownItem[] = [
    {
      label: "Duplicate",
      action: () => {
        if (handle) {
          const node = editor.state.doc.nodeAt(handle.pos);
          if (node) {
            const endPos = handle.pos + node.nodeSize;
            editor.chain().focus().insertContentAt(endPos, node.toJSON()).run();
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
            editor
              .chain()
              .focus()
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
              editor
                .chain()
                .focus()
                .deleteRange({ from: handle.pos, to: endPos })
                .insertContentAt(newPos - node.nodeSize, node.toJSON())
                .run();
            }
          }
        }
      },
    },
    ...(blockIdItem ? [blockIdItem] : []),
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
          onClick={() => setMenuOpen(!menuOpen)}
          title="Click for menu"
        >
          {"\u22EE"}
        </button>
      </div>

      {menuOpen && (
        <div
          className="block-handle-menu"
          ref={menuRef}
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

          {/* AI Submenu */}
          {blockHasContent && (
            <>
              <div className="block-handle-separator" />
              <div
                className="block-handle-ai-trigger"
                onMouseEnter={() => setAiSubOpen(true)}
                onMouseLeave={() => setAiSubOpen(false)}
              >
                <button className="block-handle-menu-item block-handle-ai-item">
                  <span>AI</span>
                  <span className="block-handle-ai-arrow">{"\u25B8"}</span>
                </button>

                {aiSubOpen && (
                  <div className="block-handle-ai-submenu" ref={aiSubRef}>
                    {aiActions.map((action) => (
                      <button
                        className="block-handle-menu-item"
                        key={action.id}
                        onClick={() => handleAIAction(action)}
                      >
                        {action.label}
                      </button>
                    ))}
                    <div className="block-handle-separator" />
                    <button
                      className="block-handle-menu-item"
                      onClick={handleCustomInstruction}
                    >
                      Custom Instruction
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
