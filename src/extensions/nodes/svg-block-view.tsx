import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
// §5.1 SVG Block NodeView — selected: textarea + preview, unselected: render +
// hover toolbar (AI / copy / download PNG / fullscreen) + right-click menu.
import { Copy, Download, Maximize2, Sparkles } from "lucide-react";

import { useUIStore } from "../../stores/ui/ui";
import { logger } from "../../utils/logger";
import {
  copySvgAsPng,
  downloadSvg,
  downloadSvgAsPng,
} from "../../utils/markdown/svg-export";
import {
  copySvgSource,
  getSvgRootWidthPercent,
  sanitizeSvg,
  setSvgRootWidth,
} from "../../utils/markdown/svg-utils";
import { showNodeViewAIMenu } from "../../utils/nodeview-ai-menu";
import { svgBlockEntryKey } from "./svg-block";
import { useAtomBlockBehavior } from "./views/use-atom-block-behavior";
import { useTextareaAutoResize } from "./views/use-textarea-auto-resize";

export function SvgBlockView({
  node,
  updateAttributes,
  selected,
  editor,
  getPos,
}: NodeViewProps): React.ReactElement {
  const code = (node.attrs.code as string) || "";
  const [localCode, setLocalCode] = useState(code);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const renderRef = useRef<HTMLDivElement>(null);
  const fullscreenTextareaRef = useRef<HTMLTextAreaElement>(null);
  // % shown while dragging an edge handle (null when not resizing).
  const [dragPct, setDragPct] = useState<null | number>(null);

  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenCode, setFullscreenCode] = useState("");
  const [viewFullscreen, setViewFullscreen] = useState(false);
  const [contextMenu, setContextMenu] = useState<null | {
    x: number;
    y: number;
  }>(null);

  // Refs for the selected-change effect (avoid re-running on every keystroke).
  const localCodeRef = useRef(localCode);
  localCodeRef.current = localCode;
  const codeRef = useRef(code);
  codeRef.current = code;
  const updateAttributesRef = useRef(updateAttributes);
  updateAttributesRef.current = updateAttributes;
  const editorRef = useRef(editor);
  editorRef.current = editor;

  // Sanitized SVG for the current source (cheap — pure string op).
  const source = selected ? localCode : code;
  const svgHtml = useMemo(
    () => (source.trim() ? sanitizeSvg(source) : ""),
    [source],
  );
  const fullscreenSvg = useMemo(
    () => (fullscreenCode.trim() ? sanitizeSvg(fullscreenCode) : ""),
    [fullscreenCode],
  );

  // Sync local code + focus textarea when entering edit mode; save on deselect.
  useEffect(() => {
    if (selected) {
      setLocalCode(codeRef.current);
      const entryState = svgBlockEntryKey.getState(editorRef.current.state);
      const enteredFromBelow = entryState?.direction === "below";
      setTimeout(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        const end = ta.value.length;
        ta.setSelectionRange(
          enteredFromBelow ? end : 0,
          enteredFromBelow ? end : 0,
        );
      }, 0);
    } else if (localCodeRef.current !== codeRef.current) {
      updateAttributesRef.current({ code: localCodeRef.current });
    }
  }, [selected]);

  useTextareaAutoResize(textareaRef, localCode, selected);

  // Dismiss context menu on outside click / Escape.
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  // Auto-resize fullscreen textarea.
  useEffect(() => {
    const ta = fullscreenTextareaRef.current;
    if (fullscreen && ta) {
      ta.style.height = "auto";
      ta.style.height = `${ta.scrollHeight}px`;
    }
  }, [fullscreenCode, fullscreen]);

  const onSaveBeforeExit = useCallback(() => {
    if (localCode !== code) updateAttributes({ code: localCode });
  }, [localCode, code, updateAttributes]);

  const isEmpty = useCallback(() => !localCode, [localCode]);
  const { deleteBlock, handleKeyDown } = useAtomBlockBehavior({
    editor,
    getPos,
    nodeSize: node.nodeSize,
    textareaRef,
    onSaveBeforeExit,
    keyboard: { backspaceOnEmpty: true, horizontalArrowExit: true },
    isEmpty,
  });

  const handlePreviewClick = useCallback(() => {
    const pos = getPos();
    if (typeof pos === "number") editor.commands.setNodeSelection(pos);
  }, [editor, getPos]);

  const openEditFullscreen = useCallback((seed: string) => {
    setFullscreenCode(seed);
    setFullscreen(true);
  }, []);

  const closeFullscreen = useCallback(() => {
    setLocalCode(fullscreenCode);
    updateAttributes({ code: fullscreenCode });
    setFullscreen(false);
  }, [fullscreenCode, updateAttributes]);

  const closeViewFullscreen = useCallback(() => {
    setViewFullscreen(false);
    requestAnimationFrame(() => editor.commands.blur());
  }, [editor]);

  const runAI = useCallback(
    (anchor: HTMLElement) => {
      if (!code.trim()) return;
      const pos = getPos();
      if (typeof pos !== "number") return;
      showNodeViewAIMenu(anchor, "svg", code, editor, pos);
    },
    [code, editor, getPos],
  );

  // Run an async toolbar/menu action, surfacing failures to the console AND a
  // visible toast instead of silently swallowing them (a denied save dialog,
  // a missing IPC command, a clipboard/rasterize error, etc.).
  const runAsync = useCallback((label: string, fn: () => Promise<unknown>) => {
    fn().catch((err) => {
      logger.error(`SVG block: ${label} failed`, err);
      const msg = err instanceof Error ? err.message : String(err);
      useUIStore.getState().showToast(`${label} failed: ${msg}`);
    });
  }, []);

  // Stored display width (% of the block) — null means natural size.
  const storedPct = getSvgRootWidthPercent(source);
  // Effective width while rendering: the live drag value wins.
  const effectivePct = dragPct ?? storedPct;

  // Notion-style edge-drag resize. The block is centred, so width tracks the
  // cursor's distance from the block centre (same maths for either handle).
  // WKWebView breaks HTML5 DnD, so drive it with mouse events (see project
  // memory). Width is committed into the fence code (width="N%") on mouseup so
  // it round-trips; live feedback runs off React state during the drag.
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const container = renderRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const containerW = rect.width;
    if (containerW <= 0) return;
    let committed: null | number = null;

    const onMove = (ev: MouseEvent) => {
      let pct = ((2 * Math.abs(ev.clientX - centerX)) / containerW) * 100;
      pct = Math.max(10, Math.min(100, pct));
      // Light snap to the nearest 10%.
      const nearest = Math.round(pct / 10) * 10;
      if (Math.abs(pct - nearest) <= 3) pct = nearest;
      committed = Math.round(pct);
      setDragPct(committed);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setDragPct(null);
      if (committed != null) {
        updateAttributesRef.current({
          code: setSvgRootWidth(codeRef.current, committed),
        });
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  // ── Fullscreen view modal (read-only) ─────────────────────────────
  const viewFullscreenModal = viewFullscreen
    ? createPortal(
        <div
          className="svg-fullscreen-overlay"
          // Stop click from bubbling through the React portal tree to the
          // NodeViewWrapper's onClick (which would select the block → edit mode).
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => {
            e.stopPropagation();
            if (e.target === e.currentTarget) {
              e.preventDefault();
              closeViewFullscreen();
            }
          }}
        >
          <div className="svg-view-fullscreen-modal">
            <div className="svg-fullscreen-header">
              <span className="svg-block-label">svg</span>
              <button
                className="svg-fullscreen-close"
                onClick={closeViewFullscreen}
                onMouseDown={(e) => e.preventDefault()}
              >
                Close
              </button>
            </div>
            <div className="svg-view-fullscreen-body">
              {svgHtml ? (
                <div
                  className="svg-block-render"
                  dangerouslySetInnerHTML={{ __html: svgHtml }}
                />
              ) : (
                <div className="svg-block-empty">Empty SVG</div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  // ── Fullscreen edit modal ─────────────────────────────────────────
  const fullscreenModal = fullscreen
    ? createPortal(
        <div
          className="svg-fullscreen-overlay"
          onClick={(e) => {
            // Don't let the click bubble through the portal to the NodeViewWrapper.
            e.stopPropagation();
            if (e.target === e.currentTarget) closeFullscreen();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") closeFullscreen();
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="svg-fullscreen-modal">
            <div className="svg-fullscreen-header">
              <span className="svg-block-label">svg</span>
              <button
                className="svg-fullscreen-close"
                onClick={closeFullscreen}
              >
                Close
              </button>
            </div>
            <div className="svg-fullscreen-body">
              <div className="svg-fullscreen-editor">
                <textarea
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoFocus
                  className="svg-block-textarea"
                  data-gramm="false"
                  onChange={(e) => setFullscreenCode(e.target.value)}
                  ref={fullscreenTextareaRef}
                  spellCheck={false}
                  value={fullscreenCode}
                />
              </div>
              <div className="svg-fullscreen-preview">
                {fullscreenSvg ? (
                  <div
                    className="svg-block-render"
                    dangerouslySetInnerHTML={{ __html: fullscreenSvg }}
                  />
                ) : (
                  <div className="svg-block-empty">Empty SVG</div>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  // ── Preview (not selected) ────────────────────────────────────────
  if (!selected) {
    return (
      <NodeViewWrapper
        className="svg-block svg-block-preview"
        contentEditable={false}
        data-type="svgBlock"
        onClick={handlePreviewClick}
        onContextMenu={(e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
        onMouseDown={(e: React.MouseEvent) => {
          if (e.button === 2) e.stopPropagation();
        }}
        ref={wrapperRef}
        spellCheck={false}
      >
        {svgHtml ? (
          <div className="svg-block-render" ref={renderRef}>
            <div
              className={
                "svg-render-frame" + (effectivePct != null ? " is-sized" : "")
              }
              style={
                effectivePct != null ? { width: `${effectivePct}%` } : undefined
              }
            >
              <div
                className="svg-render-content"
                dangerouslySetInnerHTML={{ __html: svgHtml }}
              />
              <div
                className="svg-resize-handle svg-resize-handle-left"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={startResize}
                title="Drag to resize"
              />
              <div
                className="svg-resize-handle svg-resize-handle-right"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={startResize}
                title="Drag to resize"
              />
              {dragPct != null && (
                <div className="svg-resize-label">{dragPct}%</div>
              )}
            </div>
          </div>
        ) : (
          <div className="svg-block-empty">Empty SVG block</div>
        )}

        {/* Hover toolbar */}
        {svgHtml && (
          <div
            className="svg-hover-toolbar"
            ref={(el) => {
              if (el) el.onmousedown = (e) => e.stopPropagation();
            }}
          >
            <button
              className="svg-hover-toolbar-btn"
              onClick={(e) => {
                e.stopPropagation();
                runAI(e.currentTarget);
              }}
              title="AI Commands"
            >
              <Sparkles size={14} />
            </button>
            <button
              className="svg-hover-toolbar-btn"
              onClick={(e) => {
                e.stopPropagation();
                runAsync("copy source", () => copySvgSource(code));
              }}
              title="Copy SVG source"
            >
              <Copy size={16} strokeWidth={2} />
            </button>
            <button
              className="svg-hover-toolbar-btn"
              onClick={(e) => {
                e.stopPropagation();
                runAsync("download PNG", () => downloadSvgAsPng(svgHtml));
              }}
              title="Download as PNG"
            >
              <Download size={16} strokeWidth={2} />
            </button>
            <button
              className="svg-hover-toolbar-btn"
              onClick={(e) => {
                e.stopPropagation();
                setViewFullscreen(true);
              }}
              title="Fullscreen view"
            >
              <Maximize2 size={16} strokeWidth={2} />
            </button>
          </div>
        )}

        {contextMenu &&
          createPortal(
            <div
              className="svg-context-menu"
              // Stop click from bubbling through the React portal tree to the
              // NodeViewWrapper's onClick (which would select the block → edit mode).
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                position: "fixed",
                left: contextMenu.x,
                top: contextMenu.y,
                zIndex: 9999,
              }}
            >
              <button
                className="svg-context-menu-item"
                onClick={() => {
                  runAsync("copy source", () => copySvgSource(code));
                  setContextMenu(null);
                }}
              >
                Copy SVG
              </button>
              {svgHtml && (
                <>
                  <button
                    className="svg-context-menu-item"
                    onClick={() => {
                      runAsync("copy PNG", () => copySvgAsPng(svgHtml));
                      setContextMenu(null);
                    }}
                  >
                    Copy as PNG
                  </button>
                  <button
                    className="svg-context-menu-item"
                    onClick={() => {
                      runAsync("download PNG", () => downloadSvgAsPng(svgHtml));
                      setContextMenu(null);
                    }}
                  >
                    Download PNG
                  </button>
                </>
              )}
              <button
                className="svg-context-menu-item"
                onClick={() => {
                  runAsync("download SVG", () => downloadSvg(code));
                  setContextMenu(null);
                }}
              >
                Download SVG
              </button>
              <div className="svg-context-menu-divider" />
              <button
                className="svg-context-menu-item"
                onClick={() => {
                  setViewFullscreen(true);
                  setContextMenu(null);
                }}
              >
                View Fullscreen
              </button>
              <button
                className="svg-context-menu-item"
                onClick={() => {
                  openEditFullscreen(code);
                  setContextMenu(null);
                }}
              >
                Edit Fullscreen
              </button>
              <button
                className="svg-context-menu-item svg-context-menu-danger"
                onClick={() => {
                  deleteBlock();
                  setContextMenu(null);
                }}
              >
                Delete
              </button>
            </div>,
            document.body,
          )}
        {viewFullscreenModal}
        {fullscreenModal}
      </NodeViewWrapper>
    );
  }

  // ── Editing (selected) ────────────────────────────────────────────
  return (
    <NodeViewWrapper
      className="svg-block svg-block-editing"
      contentEditable={false}
      data-type="svgBlock"
      ref={wrapperRef}
      spellCheck={false}
    >
      <div className="svg-block-header">
        <span className="svg-block-label">svg</span>
        <div className="svg-block-actions">
          <button
            className="svg-fullscreen-btn"
            onClick={() => openEditFullscreen(localCode)}
            title="Edit full-screen"
          >
            Expand
          </button>
        </div>
      </div>
      <textarea
        autoCapitalize="off"
        autoCorrect="off"
        className="svg-block-textarea"
        data-gramm="false"
        onChange={(e) => setLocalCode(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder='<svg viewBox="0 0 100 100">...</svg>'
        ref={textareaRef}
        rows={1}
        spellCheck={false}
        value={localCode}
      />
      {svgHtml && (
        <div
          className="svg-block-render svg-block-render-faded"
          dangerouslySetInnerHTML={{ __html: svgHtml }}
        />
      )}
      {fullscreenModal}
    </NodeViewWrapper>
  );
}
