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
import { Captions, Copy, Download, Maximize2, Sparkles } from "lucide-react";

import { isInNativeTextControl } from "../../utils/editor/native-text-control";
import {
  copySvgAsPng,
  downloadSvg,
  downloadSvgAsPng,
} from "../../utils/markdown/svg-export";
import {
  copySvgSource,
  ensureSvgIntrinsicSize,
  getSvgCaption,
  getSvgRootWidthPercent,
  sanitizeSvg,
  setSvgCaption,
  setSvgRootWidth,
} from "../../utils/markdown/svg-utils";
import { showNodeViewAIMenu } from "../../utils/nodeview-ai-menu";
import { updateNodeAttributesWithVim } from "../plugins/vim/vim-keys";
import { svgBlockEntryKey } from "./svg-block";
import { BlockCaption } from "./views/BlockCaption";
import { MediaToolbar, MediaToolbarButton } from "./views/MediaToolbar";
import { runBlockAction } from "./views/run-block-action";
import { useAtomBlockBehavior } from "./views/use-atom-block-behavior";
import { useAtomEditSession } from "./views/use-atom-edit-session";
import { useBlockContextMenu } from "./views/use-block-context-menu";
import { useMediaResize } from "./views/use-media-resize";
import { useRefusedCommitToast } from "./views/use-refused-commit-toast";
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

  // Refs for the selected-change effect (avoid re-running on every keystroke).
  const localCodeRef = useRef(localCode);
  localCodeRef.current = localCode;
  const codeRef = useRef(code);
  codeRef.current = code;
  const updateAttributesRef = useRef(updateAttributes);
  updateAttributesRef.current = updateAttributes;

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

  // §298 vim entry-session state machine (entry latches, dirty tracking,
  // editing derivation, Esc stair, preview click) — shared with mermaid/math
  // block views, see use-atom-edit-session.ts.
  const { editing, textareaProps, handlePreviewClick, markDirty, clearDirty } =
    useAtomEditSession({
      editor,
      getPos,
      selected,
      textareaRef,
      entryKey: svgBlockEntryKey,
      localValueRef: localCodeRef,
      committedValueRef: codeRef,
      setLocalValue: setLocalCode,
      commitValue: (value) => updateAttributes({ code: value }),
      onSaveBeforeExit,
      onKeyDown: handleKeyDown,
    });
  const refusedCommit = useRefusedCommitToast();

  // What the block acts on — the session's code while editing, the committed
  // attribute otherwise (a traversal selection never opened a session, so its
  // preview keeps rendering the attribute). The render, the menu and the
  // toolbar all read this, never the raw attribute.
  const activeSource = editing ? localCode : code;
  // Sanitized SVG for it (cheap — pure string op). issue 538: a root with a
  // viewBox and no size gets the viewBox's px size here, in the RENDERED
  // markup only, so it lays out at its natural size instead of collapsing to
  // 0 height; the source attribute — and with it the file and the resize
  // percentage — is untouched.
  const svgHtml = useMemo(
    () =>
      activeSource.trim()
        ? ensureSvgIntrinsicSize(sanitizeSvg(activeSource))
        : "",
    [activeSource],
  );
  const fullscreenSvg = useMemo(
    () =>
      fullscreenCode.trim()
        ? ensureSvgIntrinsicSize(sanitizeSvg(fullscreenCode))
        : "",
    [fullscreenCode],
  );

  // Auto-resize textarea — keyed on `editing`, NOT `selected`: the standby
  // element is 1px wide, and a measurement there writes an inflated inline
  // height that survives into the editing render.
  useTextareaAutoResize(textareaRef, localCode, editing);

  // issue 521: the block's own right-click menu — see use-block-context-menu.ts.
  const {
    close: closeBlockMenu,
    contextMenu,
    menuRef: blockMenuRef,
    onContextMenu: handleBlockContextMenu,
    onMouseDown: stopRightButtonMouseDown,
  } = useBlockContextMenu({ editing, source: activeSource, wrapperRef });

  // Auto-resize fullscreen textarea.
  useEffect(() => {
    const ta = fullscreenTextareaRef.current;
    if (fullscreen && ta) {
      ta.style.height = "auto";
      ta.style.height = `${ta.scrollHeight}px`;
    }
  }, [fullscreenCode, fullscreen]);

  const openEditFullscreen = useCallback((seed: string) => {
    setFullscreenCode(seed);
    setFullscreen(true);
  }, []);

  const closeFullscreen = useCallback(() => {
    // §12-6: fullscreen Close button commit — tagged chrome (design §5b).
    // issue 531: the helper is the capability gate and reports whether it
    // dispatched. On a refusal (read-only editor) nothing below may run —
    // the local mirror would say "saved" over an unchanged document, and
    // closing would throw the edit away. Keep the modal open with the text
    // in it; Discard is the way out that says what it does.
    const committed = updateNodeAttributesWithVim(editor, getPos, {
      code: fullscreenCode,
    });
    if (!committed) {
      refusedCommit.announce(
        "Read-only editor — fullscreen changes were not saved",
      );
      return;
    }
    refusedCommit.settle();
    setLocalCode(fullscreenCode);
    // The direct commit ENDS the textarea session — a leftover dirty flag
    // would make the next deselect re-save this (by then possibly stale)
    // local value over an Undo or external update (review S5/S6-R4).
    clearDirty();
    setFullscreen(false);
  }, [fullscreenCode, editor, getPos, clearDirty, refusedCommit]);

  /** Leave fullscreen without committing; localCode and the dirty flag are
   *  untouched, so the inline session continues exactly as it was. */
  const discardFullscreen = useCallback(() => {
    setFullscreen(false);
  }, []);

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

  // Resize: width persisted as width="N%" on the root <svg> (round-trips).
  const { dragPct, startResize } = useMediaResize(renderRef, (pct) => {
    // §12-6: resize drag commit — tagged chrome (design §5b)
    updateNodeAttributesWithVim(editor, getPos, {
      code: setSvgRootWidth(codeRef.current, pct),
    });
  });
  // Stored display width (% of the block) — null means natural size.
  const storedPct = getSvgRootWidthPercent(activeSource);
  // Effective width while rendering: the live drag value wins.
  const effectivePct = dragPct ?? storedPct;

  // Caption stored in the root <svg>'s <title> (round-trips).
  const caption = getSvgCaption(activeSource);
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
          // issue 521: a right-click inside the modal is nobody's — the block
          // ignores portal events, and the browser's page menu (Reload) must
          // not appear here. Text controls keep their native menu.
          onContextMenu={(e) => {
            if (isInNativeTextControl(e.target)) return;
            e.preventDefault();
            e.stopPropagation();
          }}
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
          // issue 521: a right-click inside the modal is nobody's — the block
          // ignores portal events, and the browser's page menu (Reload) must
          // not appear here. Text controls keep their native menu.
          onContextMenu={(e) => {
            if (isInNativeTextControl(e.target)) return;
            e.preventDefault();
            e.stopPropagation();
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
                onClick={discardFullscreen}
                title="Leave without saving"
              >
                Discard
              </button>
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
      onContextMenu={handleBlockContextMenu}
      onMouseDown={stopRightButtonMouseDown}
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
          {...textareaProps}
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
            markDirty();
            setLocalCode(e.target.value);
          }}
          placeholder='<svg viewBox="0 0 100 100">...</svg>'
          ref={textareaRef}
          rows={1}
          spellCheck={false}
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
                  runBlockAction("SVG block", "copy source", () =>
                    copySvgSource(activeSource),
                  )
                }
                title="Copy SVG source"
              >
                <Copy size={16} strokeWidth={2} />
              </MediaToolbarButton>
              <MediaToolbarButton
                onClick={() =>
                  runBlockAction("SVG block", "download PNG", () =>
                    downloadSvgAsPng(svgHtml),
                  )
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
        </>
      )}
      {contextMenu &&
        createPortal(
          <div
            className="svg-context-menu"
            // Stop click from bubbling through the React portal tree to the
            // NodeViewWrapper's onClick (which would select the block → edit mode).
            onClick={(e) => e.stopPropagation()}
            // issue 521: a right-click on the menu itself is nobody's — see
            // MermaidBlockContextMenu.
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            // issue 542: the mounted root is exempt from the capture-phase
            // dismiss, by identity (use-block-context-menu.ts).
            ref={blockMenuRef}
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
                runBlockAction("SVG block", "copy source", () =>
                  copySvgSource(activeSource),
                );
                closeBlockMenu();
              }}
            >
              Copy SVG
            </button>
            {svgHtml && (
              <>
                <button
                  className="svg-context-menu-item"
                  onClick={() => {
                    runBlockAction("SVG block", "copy PNG", () =>
                      copySvgAsPng(svgHtml),
                    );
                    closeBlockMenu();
                  }}
                >
                  Copy as PNG
                </button>
                <button
                  className="svg-context-menu-item"
                  onClick={() => {
                    runBlockAction("SVG block", "download PNG", () =>
                      downloadSvgAsPng(svgHtml),
                    );
                    closeBlockMenu();
                  }}
                >
                  Download PNG
                </button>
              </>
            )}
            <button
              className="svg-context-menu-item"
              onClick={() => {
                runBlockAction("SVG block", "download SVG", () =>
                  downloadSvg(activeSource),
                );
                closeBlockMenu();
              }}
            >
              Download SVG
            </button>
            <div className="svg-context-menu-divider" />
            <button
              className="svg-context-menu-item"
              onClick={() => {
                setViewFullscreen(true);
                closeBlockMenu();
              }}
            >
              View Fullscreen
            </button>
            <button
              className="svg-context-menu-item"
              onClick={() => {
                openEditFullscreen(activeSource);
                closeBlockMenu();
              }}
            >
              Edit Fullscreen
            </button>
            <button
              className="svg-context-menu-item svg-context-menu-danger"
              onClick={() => {
                deleteBlock();
                closeBlockMenu();
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
