import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { NodeSelection } from "@tiptap/pm/state";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
// §5.1 SVG Block NodeView — selected: textarea + preview, unselected: render +
// hover toolbar (AI / copy / download PNG / fullscreen) + right-click menu.
import { Captions, Copy, Download, Maximize2, Sparkles } from "lucide-react";

import { useUIStore } from "../../stores/ui/ui";
import { focusEditorView } from "../../utils/editor/focus-editor-view";
import { logger } from "../../utils/logger";
import {
  copySvgAsPng,
  downloadSvg,
  downloadSvgAsPng,
} from "../../utils/markdown/svg-export";
import {
  copySvgSource,
  getSvgCaption,
  getSvgRootWidthPercent,
  sanitizeSvg,
  setSvgCaption,
  setSvgRootWidth,
} from "../../utils/markdown/svg-utils";
import { showNodeViewAIMenu } from "../../utils/nodeview-ai-menu";
import {
  isWysiwygVimModal,
  updateNodeAttributesWithVim,
  vimPluginKey,
} from "../plugins/vim/vim-keys";
import { svgBlockEntryKey } from "./svg-block";
import { BlockCaption } from "./views/BlockCaption";
import { MediaToolbar, MediaToolbarButton } from "./views/MediaToolbar";
import { useAtomBlockBehavior } from "./views/use-atom-block-behavior";
import { useMediaResize } from "./views/use-media-resize";
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

  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenCode, setFullscreenCode] = useState("");
  const [viewFullscreen, setViewFullscreen] = useState(false);
  const [editingCaption, setEditingCaption] = useState(false);
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

  // §12-⑩ vim modal gate — event-time read via ref (not a reactive dep)
  const vimGateEditorRef = useRef(editor);
  vimGateEditorRef.current = editor;
  // A CLICK is an explicit request to edit and bypasses the modal gate;
  // keyboard traversal does not. Consumed on entry, cleared on deselect.
  const enterByClickRef = useRef(false);
  // §12-⑩ — the editing UI follows ENTRY, not selection (the math block's
  // model, f12e2af0). Traversal renders the PREVIEW plus a standby textarea;
  // the session opens when that textarea gains focus. Ref mirror so event
  // handlers see the current value.
  const [isEditing, setIsEditing] = useState(false);
  const isEditingRef = useRef(false);
  // Save-on-deselect fires only after REAL typing in an edit session — a
  // bare attrs-vs-local comparison writes a stale baseline back over attrs
  // updated while unselected (S5/S6 review R2).
  const editDirtyRef = useRef(false);

  // §12-⑩ — one render path, editing UI keyed on ENTRY, not selection.
  // Computed BEFORE the hooks and render-time values that key on it.
  const editing =
    selected &&
    (isEditing ||
      enterByClickRef.current ||
      !isWysiwygVimModal(vimGateEditorRef.current.state));

  // Sanitized SVG for the current source (cheap — pure string op).
  // localCode belongs to an edit SESSION — a traversal selection never opened
  // one, so its preview keeps rendering the attribute.
  const source = editing ? localCode : code;
  const svgHtml = useMemo(
    () => (source.trim() ? sanitizeSvg(source) : ""),
    [source],
  );
  const fullscreenSvg = useMemo(
    () => (fullscreenCode.trim() ? sanitizeSvg(fullscreenCode) : ""),
    [fullscreenCode],
  );

  useEffect(() => {
    if (!selected) {
      // Save on DESELECT only — a modal (vim-cursor) selection must neither
      // enter editing nor run this branch, which would restore a stale
      // local value over fresh attrs (S5/S6 review).
      // CONSUME dirty at every deselect — a completed session's flag must
      // not survive into the next one (S5/S6 review R3).
      const wasDirty = editDirtyRef.current;
      editDirtyRef.current = false;
      if (wasDirty && localCodeRef.current !== codeRef.current) {
        updateAttributesRef.current({ code: localCodeRef.current });
      }
      enterByClickRef.current = false;
      isEditingRef.current = false;
      setIsEditing(false);
    } else if (
      enterByClickRef.current ||
      !isWysiwygVimModal(vimGateEditorRef.current.state)
    ) {
      // §298 §12-⑩ — selection ALONE must not open the block while vim is
      // modal (the math block's contract, pinned per block). A click sets the
      // latch below; vim's `i` preflight focuses the STANDBY textarea and its
      // focus event opens the session.
      enterByClickRef.current = false;
      editDirtyRef.current = false;
      isEditingRef.current = true;
      setIsEditing(true);
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
    }
  }, [selected]);

  // Auto-resize textarea — keyed on `editing`, NOT `selected`: the standby
  // element is 1px wide, and a measurement there writes an inflated inline
  // height that survives into the editing render.
  useTextareaAutoResize(textareaRef, localCode, editing);

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

  // §12-⑩ entry signal — vim's `i` preflight focuses the standby textarea;
  // the click path's scheduled focus arrives here too. Opens the session once.
  const handleTextareaFocus = useCallback(() => {
    if (isEditingRef.current) return;
    isEditingRef.current = true;
    editDirtyRef.current = false;
    setLocalCode(codeRef.current);
    setIsEditing(true);
  }, []);

  // §298 Esc stair — while vim owns the surface, Esc lands normal mode and
  // the block's NodeSelection in ONE transaction, then hands focus back (see
  // math-block-view for the surface-insert entry that makes atomicity
  // necessary). Without vim, exitBlock("down") stays as it was.
  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (
        e.key === "Escape" &&
        vimPluginKey.getState(editorRef.current.state)?.enabled
      ) {
        e.preventDefault();
        e.stopPropagation();
        onSaveBeforeExit();
        enterByClickRef.current = false;
        editDirtyRef.current = false;
        isEditingRef.current = false;
        setIsEditing(false);
        const editorNow = editorRef.current;
        const pos = getPos();
        const tr = editorNow.state.tr;
        if (typeof pos === "number") {
          tr.setSelection(NodeSelection.create(tr.doc, pos));
        }
        tr.setMeta(vimPluginKey, { mode: "normal", type: "setMode" });
        editorNow.view.dispatch(tr);
        focusEditorView(editorNow.view);
        return;
      }
      handleKeyDown(e);
    },
    [getPos, handleKeyDown, onSaveBeforeExit],
  );

  const handlePreviewClick = useCallback(() => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    // §12-⑩ modal click = NAVIGATION (issue 408, UX decision): land the
    // outline exactly like j/k and stop — `i` is the entry. Non-modal (insert
    // mode, vim off) keeps the click entry below.
    if (isWysiwygVimModal(editorRef.current.state)) {
      editorRef.current.commands.setNodeSelection(pos);
      return;
    }
    // Set BEFORE the selection change: the entry effect consumes the latch on
    // the render this dispatch causes.
    enterByClickRef.current = true;
    editor.commands.setNodeSelection(pos);
    // Already-selected standby block: the selection does not change, so no
    // effect will run — the standby textarea is the entry instead.
    textareaRef.current?.focus();
  }, [editor, getPos]);

  const openEditFullscreen = useCallback((seed: string) => {
    setFullscreenCode(seed);
    setFullscreen(true);
  }, []);

  const closeFullscreen = useCallback(() => {
    setLocalCode(fullscreenCode);
    // §12-6: fullscreen Close button commit — tagged chrome (design §5b)
    updateNodeAttributesWithVim(editor, getPos, { code: fullscreenCode });
    // The direct commit ENDS the textarea session — a leftover dirty flag
    // would make the next deselect re-save this (by then possibly stale)
    // local value over an Undo or external update (review S5/S6-R4).
    editDirtyRef.current = false;
    setFullscreen(false);
  }, [fullscreenCode, editor, getPos]);

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

  // Resize: width persisted as width="N%" on the root <svg> (round-trips).
  const { dragPct, startResize } = useMediaResize(renderRef, (pct) => {
    // §12-6: resize drag commit — tagged chrome (design §5b)
    updateNodeAttributesWithVim(editor, getPos, {
      code: setSvgRootWidth(codeRef.current, pct),
    });
  });
  // Stored display width (% of the block) — null means natural size.
  const storedPct = getSvgRootWidthPercent(source);
  // Effective width while rendering: the live drag value wins.
  const effectivePct = dragPct ?? storedPct;

  // Caption stored in the root <svg>'s <title> (round-trips).
  const caption = getSvgCaption(source);
  const commitCaption = useCallback((text: string) => {
    updateAttributesRef.current({
      code: setSvgCaption(codeRef.current, text),
    });
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
                  data-vim-suspend=""
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

  // §12-⑩ — one render path, editing UI keyed on ENTRY, not selection: a
  // traversal NodeSelection keeps the preview (plus PM's selectednode
  // outline). Single path so the textarea element survives the flip — the
  // header/textarea slots are positionally stable ({editing && …} keeps its
  // index), which is what preserves the element identity for preflight focus.
  return (
    <NodeViewWrapper
      className={
        editing ? "svg-block svg-block-editing" : "svg-block svg-block-preview"
      }
      contentEditable={false}
      data-type="svgBlock"
      onClick={editing ? undefined : handlePreviewClick}
      onContextMenu={
        editing
          ? undefined
          : (e: React.MouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({ x: e.clientX, y: e.clientY });
            }
      }
      onMouseDown={
        editing
          ? undefined
          : (e: React.MouseEvent) => {
              if (e.button === 2) e.stopPropagation();
            }
      }
      ref={wrapperRef}
      spellCheck={false}
    >
      {editing && (
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
      )}
      {selected && (
        <textarea
          // Standby must not be a Tab stop nor AT-visible; programmatic
          // .focus() (vim's preflight) works regardless of tabIndex -1.
          aria-hidden={editing ? undefined : true}
          autoCapitalize="off"
          autoCorrect="off"
          className={
            editing
              ? "svg-block-textarea"
              : "svg-block-textarea svg-block-textarea-standby"
          }
          data-gramm="false"
          data-vim-suspend=""
          onChange={(e) => {
            editDirtyRef.current = true;
            setLocalCode(e.target.value);
          }}
          onFocus={handleTextareaFocus}
          onKeyDown={handleTextareaKeyDown}
          placeholder='<svg viewBox="0 0 100 100">...</svg>'
          ref={textareaRef}
          rows={1}
          spellCheck={false}
          tabIndex={editing ? 0 : -1}
          value={localCode}
        />
      )}
      {editing ? (
        svgHtml && (
          <div
            className="svg-block-render svg-block-render-faded"
            dangerouslySetInnerHTML={{ __html: svgHtml }}
          />
        )
      ) : (
        <>
          {svgHtml ? (
            <>
              <div className="svg-block-render" ref={renderRef}>
                <div
                  className={
                    "media-resize-frame" +
                    (effectivePct != null ? " is-sized" : "")
                  }
                  style={
                    effectivePct != null
                      ? { width: `${effectivePct}%` }
                      : undefined
                  }
                >
                  <div
                    className="media-resize-content"
                    dangerouslySetInnerHTML={{ __html: svgHtml }}
                  />
                  <div
                    className="media-resize-handle media-resize-handle-left"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={startResize}
                    title="Drag to resize"
                  />
                  <div
                    className="media-resize-handle media-resize-handle-right"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={startResize}
                    title="Drag to resize"
                  />
                  {dragPct != null && (
                    <div className="media-resize-label">{dragPct}%</div>
                  )}
                </div>
              </div>
              <BlockCaption
                editing={editingCaption}
                onCommit={commitCaption}
                onEditingChange={setEditingCaption}
                value={caption}
              />
            </>
          ) : (
            <div className="svg-block-empty">Empty SVG block</div>
          )}

          {/* Hover toolbar */}
          {svgHtml && (
            <MediaToolbar>
              <MediaToolbarButton
                active={editingCaption}
                onClick={() => setEditingCaption(true)}
                title="Caption"
              >
                <Captions size={16} strokeWidth={2} />
              </MediaToolbarButton>
              <MediaToolbarButton
                onClick={(e) => runAI(e.currentTarget)}
                title="AI Commands"
              >
                <Sparkles size={14} />
              </MediaToolbarButton>
              <MediaToolbarButton
                onClick={() =>
                  runAsync("copy source", () => copySvgSource(code))
                }
                title="Copy SVG source"
              >
                <Copy size={16} strokeWidth={2} />
              </MediaToolbarButton>
              <MediaToolbarButton
                onClick={() =>
                  runAsync("download PNG", () => downloadSvgAsPng(svgHtml))
                }
                title="Download as PNG"
              >
                <Download size={16} strokeWidth={2} />
              </MediaToolbarButton>
              <MediaToolbarButton
                onClick={() => setViewFullscreen(true)}
                title="Fullscreen view"
              >
                <Maximize2 size={16} strokeWidth={2} />
              </MediaToolbarButton>
            </MediaToolbar>
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
                        runAsync("download PNG", () =>
                          downloadSvgAsPng(svgHtml),
                        );
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
        </>
      )}
      {viewFullscreenModal}
      {fullscreenModal}
    </NodeViewWrapper>
  );
}
