import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { NodeSelection } from "@tiptap/pm/state";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
// §5.5 Mermaid Block NodeView — selected: textarea + preview, unselected: SVG render
// §50 Enhanced: template picker + full-screen edit
import { Captions, Copy, Download, Maximize2, Sparkles } from "lucide-react";

import { focusEditorView } from "../../utils/editor/focus-editor-view";
import {
  copyMermaidPng,
  copyMermaidSource,
  copyMermaidSvg,
  detectMermaidType,
  downloadMermaidPng,
  MERMAID_TEMPLATES,
  MERMAID_THEME,
  MERMAID_THEME_VARIABLES,
  normalizeMermaidSvgSize,
  sanitizeMermaidSvg,
} from "../../utils/markdown/mermaid-utils";
import { showNodeViewAIMenu } from "../../utils/nodeview-ai-menu";
import {
  isWysiwygVimModal,
  updateNodeAttributesWithVim,
  vimPluginKey,
} from "../plugins/vim/vim-keys";
import { mermaidBlockEntryKey } from "./mermaid-block";
import { BlockCaption } from "./views/BlockCaption";
import { onFirstVisible } from "./views/lazy-visible";
import { MediaToolbar, MediaToolbarButton } from "./views/MediaToolbar";
import { useAtomBlockBehavior } from "./views/use-atom-block-behavior";
import { useMediaResize } from "./views/use-media-resize";
import { useTextareaAutoResize } from "./views/use-textarea-auto-resize";

export function MermaidBlockView({
  node,
  updateAttributes,
  selected,
  editor,
  getPos,
}: NodeViewProps) {
  const code = (node.attrs.code as string) || "";
  const [localCode, setLocalCode] = useState(code);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const renderRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<null | string>(null);
  const [svgHtml, setSvgHtml] = useState<string>("");
  // §5.12: whether a render has been ATTEMPTED, which is not the same question
  // as whether it produced anything. "no SVG yet" is the DOM for three
  // different states — still lazy, empty source, failed — and the export has to
  // tell "wait for this" from "nothing is coming" without guessing. Reflected
  // onto the wrapper as `data-render-state` (export-heavy-blocks.ts).
  const [renderAttempted, setRenderAttempted] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenCode, setFullscreenCode] = useState("");
  const [fullscreenSvg, setFullscreenSvg] = useState("");
  const [fullscreenError, setFullscreenError] = useState<null | string>(null);
  const [contextMenu, setContextMenu] = useState<null | {
    x: number;
    y: number;
  }>(null);
  const [viewFullscreen, setViewFullscreen] = useState(false);
  const [editingCaption, setEditingCaption] = useState(false);
  const fullscreenTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Defer rendering until the block is near the viewport (§perf-large-file)
  const [isVisible, setIsVisible] = useState(false);
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

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    return onFirstVisible(el, () => setIsVisible(true));
  }, []);

  // Refs so the selected-change effect can access latest values without listing
  // them as deps (localCode changes on every keystroke; adding it would re-run
  // the effect — and re-focus the textarea — on every character typed).
  const localCodeRef = useRef(localCode);
  localCodeRef.current = localCode;
  const codeRef = useRef(code);
  codeRef.current = code;
  const updateAttributesRef = useRef(updateAttributes);
  updateAttributesRef.current = updateAttributes;
  const editorRef = useRef(editor);
  editorRef.current = editor;

  // Render Mermaid SVG (async — dynamic import)
  useEffect(() => {
    if (!isVisible) return;
    // localCode belongs to an edit SESSION — a traversal selection never
    // opened one, so its preview keeps rendering the attribute. Ref read, not
    // a dep: at session start localCode === code, and the divergence (typing)
    // already re-runs this via the localCode dep (see math-block-view).
    const sessionOpen = selected && isEditingRef.current;
    const source = sessionOpen ? localCode : code;
    if (!source.trim()) {
      setSvgHtml("");
      setError(null);
      setRenderAttempted(true);
      return;
    }

    let cancelled = false;

    const timer = setTimeout(
      () => {
        renderMermaid(
          source,
          (svg) => {
            if (!cancelled) {
              setSvgHtml(svg);
              setError(null);
              setRenderAttempted(true);
            }
          },
          (msg) => {
            if (!cancelled) {
              setError(msg);
              setRenderAttempted(true);
            }
          },
        );
      },
      sessionOpen ? 300 : 0,
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isVisible, localCode, code, selected]);

  // Sync local code and focus textarea when entering edit mode
  useEffect(() => {
    if (!selected) {
      // Save on deselect
      // CONSUME dirty at every deselect — a completed session's flag must
      // not survive into the next one (S5/S6 review R3).
      const wasDirty = editDirtyRef.current;
      editDirtyRef.current = false;
      if (wasDirty && localCodeRef.current !== codeRef.current) {
        updateAttributesRef.current({ code: localCodeRef.current });
      }
      setShowTemplates(false);
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
      const entryState = mermaidBlockEntryKey.getState(editorRef.current.state);
      const enteredFromBelow = entryState?.direction === "below";

      setTimeout(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        if (enteredFromBelow) {
          ta.setSelectionRange(ta.value.length, ta.value.length);
        } else {
          ta.setSelectionRange(0, 0);
        }
      }, 0);
    }
  }, [selected]);

  // §12-⑩ — one render path, editing UI keyed on ENTRY, not selection.
  // Computed BEFORE the hooks that key on it. Single path keeps the textarea
  // element alive across the flip, so a preflight focus never lands on a node
  // React is about to replace (see math-block-view for the full story).
  const editing =
    selected &&
    (isEditing ||
      enterByClickRef.current ||
      !isWysiwygVimModal(vimGateEditorRef.current.state));

  // Auto-resize textarea — keyed on `editing`, NOT `selected`: the standby
  // element is 1px wide, and a measurement there writes an inflated inline
  // height that survives into the editing render.
  useTextareaAutoResize(textareaRef, localCode, editing);

  // Close template dropdown on outside click
  useEffect(() => {
    if (!showTemplates) return;
    const handler = (e: MouseEvent) => {
      const wrapper = wrapperRef.current;
      if (
        wrapper &&
        !wrapper
          .querySelector(".mermaid-template-wrapper")
          ?.contains(e.target as Node)
      ) {
        setShowTemplates(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showTemplates]);

  // Dismiss context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

  // Listen for fullscreen custom event from context menu
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const handler = () => {
      setFullscreenCode(localCode || code);
      setFullscreenSvg(svgHtml);
      setFullscreenError(error);
      setFullscreen(true);
    };
    wrapper.addEventListener("mermaid-fullscreen", handler);
    return () => wrapper.removeEventListener("mermaid-fullscreen", handler);
  }, [localCode, code, svgHtml, error]);

  // Fullscreen rendering
  useEffect(() => {
    if (!fullscreen) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      renderMermaid(
        fullscreenCode,
        (svg) => {
          if (!cancelled) {
            setFullscreenSvg(svg);
            setFullscreenError(null);
          }
        },
        (msg) => {
          if (!cancelled) setFullscreenError(msg);
        },
      );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fullscreenCode, fullscreen]);

  // Auto-resize fullscreen textarea
  useEffect(() => {
    if (fullscreen && fullscreenTextareaRef.current) {
      fullscreenTextareaRef.current.style.height = "auto";
      fullscreenTextareaRef.current.style.height =
        fullscreenTextareaRef.current.scrollHeight + "px";
    }
  }, [fullscreenCode, fullscreen]);

  // Common atom-block behavior: deleteBlock, exitBlock, handleKeyDown
  const onSaveBeforeExit = useCallback(() => {
    if (localCode !== code) {
      updateAttributes({ code: localCode });
    }
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
  // the block's NodeSelection in ONE transaction, then hands focus back
  // (entering from surface insert mode leaves vim in insert, and a latch-only
  // exit would leave an editable view over a live NodeSelection — the state
  // where the next keystroke replaces the block). Without vim,
  // exitBlock("down") stays as it was.
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

  // §5.5 resize + caption — stored as node attrs; the transformer serializes them
  // into a `%% baram-meta` comment line in the fence (mermaid ignores it) so they
  // round-trip while the editable `code` stays a pure diagram.
  const widthPercent = (node.attrs.width as null | number) ?? null;
  const caption = (node.attrs.caption as null | string) ?? null;
  const { dragPct, startResize } = useMediaResize(renderRef, (pct) => {
    // §12-6: resize drag commit — tagged chrome (design §5b)
    updateNodeAttributesWithVim(editor, getPos, { width: pct });
  });
  const effectivePct = dragPct ?? widthPercent;
  const commitCaption = useCallback(
    (text: string) => {
      updateAttributes({ caption: text || null });
    },
    [updateAttributes],
  );

  const applyTemplate = useCallback((key: string) => {
    // Template application IS an edit — it must survive deselect (R3).
    editDirtyRef.current = true;
    const template = MERMAID_TEMPLATES[key];
    if (!template) return;
    setLocalCode(template.code);
    setShowTemplates(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  const closeFullscreen = useCallback(() => {
    // Save fullscreen changes back
    setLocalCode(fullscreenCode);
    // §12-6: fullscreen Close button commit — tagged chrome (design §5b)
    updateNodeAttributesWithVim(editor, getPos, { code: fullscreenCode });
    // The direct commit ENDS the textarea session — a leftover dirty flag
    // would make the next deselect re-save this (by then possibly stale)
    // local value over an Undo or external update (review S5/S6-R4).
    editDirtyRef.current = false;
    setFullscreen(false);
  }, [fullscreenCode, editor, getPos]);

  const detectedType = detectMermaidType(localCode);

  // Fullscreen View modal (read-only — diagram only, no editor)
  const closeViewFullscreen = useCallback(() => {
    setViewFullscreen(false);
    // Prevent ProseMirror from selecting the mermaid block when modal closes
    requestAnimationFrame(() => {
      editor.commands.blur();
    });
  }, [editor]);

  const viewFullscreenModal = viewFullscreen
    ? createPortal(
        <div
          className="mermaid-fullscreen-overlay"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Escape") closeViewFullscreen();
          }}
          onMouseDown={(e) => {
            e.stopPropagation(); // Prevent React event from reaching NodeViewWrapper
            if (e.target === e.currentTarget) {
              e.preventDefault();
              closeViewFullscreen();
            }
          }}
        >
          <div className="mermaid-view-fullscreen-modal">
            <div className="mermaid-fullscreen-header">
              <span className="mermaid-block-label">mermaid</span>
              {detectedType && (
                <span className="mermaid-fullscreen-type">
                  {MERMAID_TEMPLATES[detectedType]?.label || detectedType}
                </span>
              )}
              <button
                className="mermaid-fullscreen-close"
                onClick={closeViewFullscreen}
                onMouseDown={(e) => e.preventDefault()}
              >
                Close
              </button>
            </div>
            <div className="mermaid-view-fullscreen-body">
              {svgHtml ? (
                <div
                  className="mermaid-block-svg"
                  dangerouslySetInnerHTML={{ __html: svgHtml }}
                />
              ) : error ? (
                <div className="mermaid-block-error">{error}</div>
              ) : (
                <div className="mermaid-block-empty">Empty diagram</div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  // Fullscreen edit modal
  const fullscreenModal = fullscreen
    ? createPortal(
        <div
          className="mermaid-fullscreen-overlay"
          onClick={(e) => {
            // Don't let clicks bubble through the portal to the block's onClick.
            e.stopPropagation();
            if (e.target === e.currentTarget) closeFullscreen();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") closeFullscreen();
          }}
        >
          <div className="mermaid-fullscreen-modal">
            <div className="mermaid-fullscreen-header">
              <span className="mermaid-block-label">mermaid</span>
              {detectedType && (
                <span className="mermaid-fullscreen-type">
                  {MERMAID_TEMPLATES[detectedType]?.label || detectedType}
                </span>
              )}
              <button
                className="mermaid-fullscreen-close"
                onClick={closeFullscreen}
              >
                Close
              </button>
            </div>
            <div className="mermaid-fullscreen-body">
              <div className="mermaid-fullscreen-editor">
                <textarea
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoFocus
                  className="mermaid-block-textarea"
                  data-gramm="false"
                  data-vim-suspend=""
                  onChange={(e) => setFullscreenCode(e.target.value)}
                  ref={fullscreenTextareaRef}
                  spellCheck={false}
                  value={fullscreenCode}
                />
              </div>
              <div className="mermaid-fullscreen-preview">
                {fullscreenSvg ? (
                  <div
                    className={[
                      "mermaid-block-svg",
                      fullscreenError && "mermaid-block-svg-faded",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    dangerouslySetInnerHTML={{ __html: fullscreenSvg }}
                  />
                ) : null}
                {fullscreenError && (
                  <div className="mermaid-block-error">{fullscreenError}</div>
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
  // outline). Single path so the textarea element survives the flip —
  // preflight focus must not land on a node React is about to replace. The
  // header/textarea slots are positionally stable ({editing && …} keeps its
  // index), which is what preserves the element identity.
  return (
    <NodeViewWrapper
      className={
        editing
          ? "mermaid-block mermaid-block-editing"
          : "mermaid-block mermaid-block-preview"
      }
      contentEditable={false}
      data-render-state={renderAttempted ? "done" : "pending"}
      data-type="mermaidBlock"
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
              // Prevent right-click from propagating to ProseMirror
              // which would set NodeSelection and switch to editing mode
              if (e.button === 2) {
                e.stopPropagation();
              }
            }
      }
      ref={wrapperRef}
      spellCheck={false}
    >
      {editing && (
        <div className="mermaid-block-header">
          <span className="mermaid-block-label">mermaid</span>
          {detectedType && (
            <span className="mermaid-block-type-badge">
              {MERMAID_TEMPLATES[detectedType]?.label || detectedType}
            </span>
          )}
          <div className="mermaid-block-actions">
            <div className="mermaid-template-wrapper">
              <button
                className="mermaid-template-btn"
                onClick={() => setShowTemplates(!showTemplates)}
                title="Diagram templates"
              >
                Template ▾
              </button>
              {showTemplates && (
                <div className="mermaid-template-dropdown">
                  {Object.entries(MERMAID_TEMPLATES).map(([key, tmpl]) => (
                    <button
                      className={[
                        "mermaid-template-dropdown-item",
                        detectedType === key && "mermaid-template-active",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={key}
                      onClick={() => applyTemplate(key)}
                    >
                      {tmpl.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              className="mermaid-fullscreen-btn"
              onClick={() => {
                setFullscreenCode(localCode);
                setFullscreenSvg(svgHtml);
                setFullscreenError(error);
                setFullscreen(true);
              }}
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
              ? "mermaid-block-textarea"
              : "mermaid-block-textarea mermaid-block-textarea-standby"
          }
          data-gramm="false"
          data-vim-suspend=""
          onChange={(e) => {
            editDirtyRef.current = true;
            setLocalCode(e.target.value);
          }}
          onFocus={handleTextareaFocus}
          onKeyDown={handleTextareaKeyDown}
          placeholder="flowchart LR&#10;  A --> B"
          ref={textareaRef}
          rows={1}
          spellCheck={false}
          tabIndex={editing ? 0 : -1}
          value={localCode}
        />
      )}
      {editing ? (
        <>
          {svgHtml ? (
            <div
              className={[
                "mermaid-block-svg",
                error && "mermaid-block-svg-faded",
              ]
                .filter(Boolean)
                .join(" ")}
              dangerouslySetInnerHTML={{ __html: svgHtml }}
              ref={renderRef}
            />
          ) : null}
          {error && <div className="mermaid-block-error">{error}</div>}
        </>
      ) : (
        <>
          {svgHtml ? (
            <>
              <div className="media-render" ref={renderRef}>
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
          ) : error ? (
            <div className="mermaid-block-error">{error}</div>
          ) : (
            <div className="mermaid-block-empty">Empty diagram</div>
          )}
          {/* Hover toolbar — appears on mouse hover */}
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
                onClick={(e) => {
                  if (!code.trim()) return;
                  const pos = getPos();
                  if (typeof pos !== "number") return;
                  showNodeViewAIMenu(
                    e.currentTarget,
                    "diagram",
                    code,
                    editor,
                    pos,
                  );
                }}
                title="AI Commands"
              >
                <Sparkles size={14} />
              </MediaToolbarButton>
              <MediaToolbarButton
                onClick={() => copyMermaidSource(code)}
                title="Copy source code"
              >
                <Copy size={16} strokeWidth={2} />
              </MediaToolbarButton>
              <MediaToolbarButton
                onClick={() => void downloadMermaidPng(code)}
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
                className="mermaid-context-menu"
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
                {svgHtml && (
                  <>
                    <button
                      className="mermaid-context-menu-item"
                      onClick={() => {
                        copyMermaidSvg(svgHtml);
                        setContextMenu(null);
                      }}
                    >
                      Copy as SVG
                    </button>
                    <button
                      className="mermaid-context-menu-item"
                      onClick={() => {
                        copyMermaidPng(code);
                        setContextMenu(null);
                      }}
                    >
                      Copy as PNG
                    </button>
                    <button
                      className="mermaid-context-menu-item"
                      onClick={() => {
                        void downloadMermaidPng(code);
                        setContextMenu(null);
                      }}
                    >
                      Download PNG
                    </button>
                  </>
                )}
                <button
                  className="mermaid-context-menu-item"
                  onClick={() => {
                    copyMermaidSource(code);
                    setContextMenu(null);
                  }}
                >
                  Copy Source
                </button>
                <div className="mermaid-context-menu-divider" />
                <button
                  className="mermaid-context-menu-item"
                  onClick={() => {
                    setViewFullscreen(true);
                    setContextMenu(null);
                  }}
                >
                  View Fullscreen
                </button>
                <button
                  className="mermaid-context-menu-item"
                  onClick={() => {
                    setFullscreenCode(code);
                    setFullscreenSvg(svgHtml);
                    setFullscreenError(error);
                    setFullscreen(true);
                    setContextMenu(null);
                  }}
                >
                  Edit Fullscreen
                </button>
                <button
                  className="mermaid-context-menu-item mermaid-context-menu-danger"
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

// §perf-large-file C3.4: use randomUUID so concurrent editor instances never
// share an ID. The old module-level counter would generate colliding IDs when
// two MermaidBlockView instances across two editors rendered simultaneously.
function newMermaidId(): string {
  // crypto.randomUUID() is available in all modern browsers and WKWebView.
  // Mermaid requires IDs starting with a letter.
  return `mermaid-${crypto.randomUUID()}`;
}

/** Shared rendering logic */
async function renderMermaid(
  source: string,
  onSuccess: (svg: string) => void,
  onError: (msg: string) => void,
): Promise<void> {
  if (!source.trim()) {
    onSuccess("");
    return;
  }
  try {
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({
      startOnLoad: false,
      // One palette for every render path — see MERMAID_THEME's note for why
      // this deliberately ignores the app theme.
      theme: MERMAID_THEME,
      themeVariables: MERMAID_THEME_VARIABLES,
      // "antiscript" allows inline HTML in labels (e.g. <br>, <b>, <i>) while
      // stripping <script>. "strict" would HTML-encode every tag, breaking <br>.
      securityLevel: "antiscript",
    });
    const id = newMermaidId();
    const { svg } = await mermaid.render(id, source);
    // foreignObject hosts HTML labels (flowchart node text). DOMPurify must
    // treat it as an HTML integration point or the label markup is stripped —
    // see sanitizeMermaidSvg. <script>/event handlers stay forbidden.
    // normalizeMermaidSvgSize strips Mermaid's `width="100%"` + inline
    // `max-width` cap so the resize frame controls the size (§5.5).
    onSuccess(normalizeMermaidSvgSize(sanitizeMermaidSvg(svg)));
  } catch (err) {
    onError(err instanceof Error ? err.message : "Mermaid rendering error");
  }
}
