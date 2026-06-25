// §4.8 Block Handle — drag handle + menu on block hover
// §11.2.3 BlockHandle AI submenu — contextual AI actions per block type
import { useCallback, useEffect, useRef, useState } from "react";

import type { Editor } from "@tiptap/react";

import { GripVertical, Sparkles } from "lucide-react";

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
import { buildTurnIntoItems } from "../../utils/toolbar/block-turn-into";
import { getEditorZoom } from "../../utils/zoom-coords";
import { useBlockDrag } from "./use-block-drag";

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
  const [turnIntoOpen, setTurnIntoOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const aiSubRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<null | ReturnType<typeof setTimeout>>(null);

  // Cancel any pending hide timeout
  const cancelHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  // Track which block the mouse is hovering over
  useEffect(() => {
    const editorDom = editor.view.dom;
    // Listen on scroll container for wider event surface (includes gutter area)
    const scrollContainer = (editorDom.closest("[data-editor-scroll]") ??
      editorDom.parentElement ??
      editorDom) as HTMLElement;

    const handleMouseMove = (e: MouseEvent) => {
      if (menuOpen) return;
      cancelHideTimeout();

      // §4.2 Zoom: editorRect and mouse events are both in visual viewport
      // space, but the gutter band and probe offset are content-space sizes that
      // scale with zoom — multiply by the zoom factor so the hover zone tracks
      // the (scaled) gutter at any zoom level. No-op at zoom 1.
      const zoom = getEditorZoom();
      const editorRect = editorDom.getBoundingClientRect();
      // Reveal the handle whenever the mouse is anywhere over the editor's
      // horizontal span — from just left of the gutter through the full
      // content width — so hovering *inside* a block (not only its left edge)
      // shows the handle, matching Notion. The probe below still samples the
      // left edge to resolve which block the cursor's row belongs to.
      if (
        e.clientX < editorRect.left - 10 * zoom ||
        e.clientX > editorRect.right + 10 * zoom
      ) {
        setHandle(null);
        return;
      }

      // Find the block-level node under the cursor. posAtCoords() takes visual
      // viewport coords; probe 80 content-px (× zoom) into the editor.
      try {
        const pos = editor.view.posAtCoords({
          left: editorRect.left + 80 * zoom,
          top: e.clientY,
        });
        if (!pos) {
          setHandle(null);
          return;
        }

        // Resolve the top-level block under the probe. Plain text blocks
        // (paragraph/heading/list) land *inside* their content (depth ≥ 1),
        // so the nearest depth-1 ancestor is the block. But atom & custom
        // NodeView blocks (mathBlock, mermaidBlock, codeBlock/CodeMirror) have
        // no editable caret position inside them, so posAtCoords reports a node
        // *boundary* (depth 0) — the depth check alone rejected them and the
        // handle never appeared. posAtCoords also returns `inside`: the start
        // position of the node the coords fell within. Fall back to it so these
        // NodeView blocks get a handle too.
        const resolved = editor.state.doc.resolve(pos.pos);
        let blockPos: null | number = null;
        if (resolved.depth >= 1) {
          blockPos = resolved.before(1);
        } else if (pos.inside >= 0) {
          const $inside = editor.state.doc.resolve(pos.inside);
          blockPos = $inside.depth >= 1 ? $inside.before(1) : pos.inside;
        }
        if (blockPos === null) {
          setHandle(null);
          return;
        }
        const dom = editor.view.nodeDOM(blockPos);
        if (!dom || !(dom instanceof HTMLElement)) {
          setHandle(null);
          return;
        }

        const domRect = dom.getBoundingClientRect();
        // §4.8 Align the handle to the vertical center of the block's FIRST
        // line, not its top edge. For large-font blocks (headings) the top
        // edge sits well above the visual center of the glyphs, leaving the
        // handle floating high. Offset by (first-line-center − btn-center).
        // Applied uniformly to every block — including atom/NodeView blocks
        // (math/mermaid) — so handle placement stays consistent across the
        // document. computed line-height/padding are content-space sizes →
        // × zoom to match the visual-space domRect.top. No-op at zoom 1.
        const cs = window.getComputedStyle(dom);
        let lineHeight = parseFloat(cs.lineHeight);
        if (Number.isNaN(lineHeight)) {
          lineHeight = parseFloat(cs.fontSize) * 1.2;
        }
        const paddingTop = parseFloat(cs.paddingTop) || 0;
        const BTN_HEIGHT = 24; // .block-handle-btn height (toolbar.css)
        const lineCenterOffset =
          (paddingTop + lineHeight / 2 - BTN_HEIGHT / 2) * zoom;
        setHandle({ top: domRect.top + lineCenterOffset, pos: blockPos });
      } catch {
        setHandle(null);
      }
    };

    const handleMouseLeave = () => {
      if (menuOpen) return;
      // Delay hide so user can move cursor to the handle element
      hideTimeoutRef.current = setTimeout(() => {
        setHandle(null);
      }, 300);
    };

    // Hide on scroll: the handle is position:fixed and its top was captured at
    // a single scroll offset, so it stays pinned on screen while the block
    // scrolls away — leaving it stranded over the wrong block. Clear it (and any
    // open menu) so the next mousemove re-places it on the block under the
    // cursor. passive: hot path, never preventDefault.
    const handleScroll = () => {
      setHandle(null);
      setMenuOpen(false);
      setAiSubOpen(false);
      setTurnIntoOpen(false);
    };

    scrollContainer.addEventListener("mousemove", handleMouseMove);
    scrollContainer.addEventListener("mouseleave", handleMouseLeave);
    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      scrollContainer.removeEventListener("mousemove", handleMouseMove);
      scrollContainer.removeEventListener("mouseleave", handleMouseLeave);
      scrollContainer.removeEventListener("scroll", handleScroll);
      cancelHideTimeout();
    };
  }, [editor, menuOpen, cancelHideTimeout]);

  // Reset handle when document changes (e.g. tab switch, wikilink navigation)
  useEffect(() => {
    const handler = () => {
      setHandle(null);
      setMenuOpen(false);
      setAiSubOpen(false);
      setTurnIntoOpen(false);
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
    };
  }, [editor]);

  // §4.2 Hide the handle on zoom (and window resize). A handle that's already
  // showing was positioned & sized for the OLD zoom level, so it visibly drifts
  // and rescales until the next hover recomputes it. applyZoom() in use-zoom.ts
  // dispatches a "resize" event right after changing --editor-zoom, so clearing
  // here makes the handle vanish during zoom; the next mousemove re-places it
  // correctly at the new zoom.
  useEffect(() => {
    const hide = () => {
      setHandle(null);
      setMenuOpen(false);
      setAiSubOpen(false);
      setTurnIntoOpen(false);
    };
    window.addEventListener("resize", hide);
    return () => window.removeEventListener("resize", hide);
  }, []);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setAiSubOpen(false);
        setTurnIntoOpen(false);
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

  // §4.8 Drag-to-reorder — must be called before any early return (hooks rule)
  const { startDrag, isDragging } = useBlockDrag(editor);

  const handleMenuAction = useCallback((action: () => void) => {
    action();
    setMenuOpen(false);
    setAiSubOpen(false);
    setTurnIntoOpen(false);
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

  // §4.8 Turn-into submenu — block type conversions
  const turnIntoItems = buildTurnIntoItems(editor, handle.pos);

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
  // §4.2 Zoom: the handle/menu are position:fixed inside the zoomed
  // .editor-area-scroll, which renders such elements at (zoom × top, zoom × left)
  // — scaled from the viewport origin (measured in WKWebView). getBoundingClientRect
  // already returns scaled visual coords, so dividing the target visual position
  // by the zoom factor cancels the render-time scaling and the handle lands
  // exactly on the block. No-op at zoom 1.
  const renderZoom = getEditorZoom();
  const handlePos = {
    // editorRect.left is visual; the 14px gutter inset is a content-space size,
    // so it must NOT be divided by zoom — only the visual term is. Writing it
    // as `editorRect.left / zoom + 14` keeps the inset a constant 14 content-px
    // at every zoom level. (Folding it into `(editorRect.left + 14) / zoom`
    // shrinks the inset to 14/zoom content-px, so the handle drifts toward the
    // text on zoom-in and away on zoom-out.) y already bakes × zoom into
    // lineCenterOffset, which is why only x drifted.
    x: editorRect.left / renderZoom + 14,
    y: handle.top / renderZoom,
  };

  return (
    <>
      <div
        className="block-handle"
        onMouseEnter={cancelHideTimeout}
        onMouseLeave={() => {
          if (!menuOpen) {
            hideTimeoutRef.current = setTimeout(() => {
              setHandle(null);
            }, 300);
          }
        }}
        ref={handleRef}
        style={{
          top: `${handlePos.y}px`,
          left: `${handlePos.x}px`,
        }}
      >
        <button
          className="block-handle-btn"
          onClick={() => {
            if (isDragging) return; // a drag just ended — don't toggle the menu
            setMenuOpen(!menuOpen);
          }}
          onMouseDown={(e) => handle && startDrag(e, handle.pos)}
          title="Drag to move · click for menu"
        >
          <GripVertical size={16} strokeWidth={2} />
        </button>
      </div>

      {menuOpen && (
        <div
          className="block-handle-menu"
          ref={menuRef}
          style={{
            top: `${handlePos.y}px`,
            left: `${handlePos.x}px`,
          }}
        >
          {/* Turn into submenu — first entry §4.8 */}
          {turnIntoItems.length > 0 && (
            <div
              className="block-handle-ai-trigger"
              onMouseEnter={() => setTurnIntoOpen(true)}
              onMouseLeave={() => setTurnIntoOpen(false)}
            >
              <button className="block-handle-menu-item block-handle-ai-item">
                <span>Turn into</span>
                <span className="block-handle-ai-arrow">{"▸"}</span>
              </button>
              {turnIntoOpen && (
                <div className="block-handle-ai-submenu">
                  {turnIntoItems.map((item) => (
                    <button
                      className="block-handle-menu-item"
                      key={item.label}
                      onClick={() => handleMenuAction(() => item.run())}
                    >
                      {item.isActive ? `✓ ${item.label}` : item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {turnIntoItems.length > 0 && (
            <div className="block-handle-separator" />
          )}

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
                  <Sparkles size={14} />
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
