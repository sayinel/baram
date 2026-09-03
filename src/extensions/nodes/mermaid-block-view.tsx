import React, { useCallback, useEffect, useRef, useState } from "react";

import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
// §5.5 Mermaid Block NodeView — selected: textarea + preview, unselected: SVG render
// §50 Enhanced: template picker + full-screen edit
import { Captions, Copy, Download, Maximize2, Sparkles } from "lucide-react";

import {
  closeAllContextMenus,
  onCloseAllContextMenus,
} from "../../utils/editor/context-menu-exclusive";
import { isInNativeTextControl } from "../../utils/editor/native-text-control";
import {
  copyMermaidSource,
  detectMermaidType,
  downloadMermaidPng,
  MERMAID_TEMPLATES,
} from "../../utils/markdown/mermaid-utils";
import { showNodeViewAIMenu } from "../../utils/nodeview-ai-menu";
import { updateNodeAttributesWithVim } from "../plugins/vim/vim-keys";
import { mermaidBlockEntryKey } from "./mermaid-block";
import { BlockCaption } from "./views/BlockCaption";
import { onFirstVisible } from "./views/lazy-visible";
import { MediaToolbar, MediaToolbarButton } from "./views/MediaToolbar";
import { renderMermaid } from "./views/mermaid-render";
import { MermaidBlockContextMenu } from "./views/MermaidBlockContextMenu";
import { MermaidBlockHeader } from "./views/MermaidBlockHeader";
import {
  MermaidEditFullscreenModal,
  MermaidViewFullscreenModal,
} from "./views/MermaidFullscreenModals";
import { useAtomBlockBehavior } from "./views/use-atom-block-behavior";
import { useAtomEditSession } from "./views/use-atom-edit-session";
import { useMediaResize } from "./views/use-media-resize";
import { useRefusedCommitToast } from "./views/use-refused-commit-toast";
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
  // The source `svgHtml` was rendered FROM. The render is debounced and a
  // failed render keeps the last good svg, so while editing the two can
  // disagree — the block menu must not offer that svg as if it were the
  // current diagram (issue 521 final review).
  const [renderedSource, setRenderedSource] = useState("");
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

  // Render Mermaid SVG (async — dynamic import)
  useEffect(() => {
    if (!isVisible) return;
    // localCode belongs to an edit SESSION — a traversal selection never
    // opened one, so its preview keeps rendering the attribute. Ref read, not
    // a dep: at session start localCode === code, and the divergence (typing)
    // already re-runs this via the localCode dep (see math-block-view).
    // sessionOpenRef comes from useAtomEditSession below — the closure only
    // reads it once this effect actually runs (after render), by which time
    // the hook call has already assigned it.
    const sessionOpen = selected && sessionOpenRef.current;
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
              setRenderedSource(source);
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
    // sessionOpenRef can't be listed: useAtomEditSession (which returns it)
    // is called further down, after this effect, to keep this render effect
    // registered before the hook's own entry effect (see use-atom-edit-session.ts
    // JSDoc) — the exact ordering the original inline "selected" effect had.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, localCode, code, selected]);

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

  // §298 vim entry-session state machine (entry latches, dirty tracking,
  // editing derivation, Esc stair, preview click) — shared with svg/math
  // block views, see use-atom-edit-session.ts. onDeselect closes the
  // template dropdown, the one real per-view difference found in review.
  const {
    editing,
    sessionOpenRef,
    textareaProps,
    handlePreviewClick,
    markDirty,
    clearDirty,
  } = useAtomEditSession({
    editor,
    getPos,
    selected,
    textareaRef,
    entryKey: mermaidBlockEntryKey,
    localValueRef: localCodeRef,
    committedValueRef: codeRef,
    setLocalValue: setLocalCode,
    commitValue: (value) => updateAttributes({ code: value }),
    onSaveBeforeExit,
    onKeyDown: handleKeyDown,
    onDeselect: () => setShowTemplates(false),
  });
  const refusedCommit = useRefusedCommitToast();

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
    // issue 521: another menu opening (or a right-click yielded to the
    // browser) elsewhere closes this one — the mousedown above never arrives
    // when the other block stops it (context-menu-exclusive.ts).
    const offCloseAll = onCloseAllContextMenus(dismiss);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", handleKey);
      offCloseAll();
    };
  }, [contextMenu]);

  // issue 521: the menu is bound to the mode it opened in (menuCode — the
  // session's code while editing, the committed one otherwise), so a mode
  // flip closes it. That also covers an Escape the textarea's vim stair
  // stops before the document listener above can see it.
  useEffect(() => {
    setContextMenu(null);
  }, [editing]);

  // Seed the fullscreen editor and open it. Two call sites share this
  // code→svg→error→open sequence (the header's Expand button and the block's
  // context menu's Edit Fullscreen item) — collapsed into one action. They
  // differ only in WHICH code string they seed (the header always has an
  // open edit session so it seeds `localCode`; the context menu is reachable
  // in both modes since issue 521 and seeds `menuCode`), so that stays a
  // param.
  const openEditFullscreen = useCallback(
    (source: string) => {
      setFullscreenCode(source);
      setFullscreenSvg(svgHtml);
      setFullscreenError(error);
      setFullscreen(true);
    },
    [svgHtml, error],
  );

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

  const applyTemplate = useCallback(
    (key: string) => {
      // Template application IS an edit — it must survive deselect (R3).
      markDirty();
      const template = MERMAID_TEMPLATES[key];
      if (!template) return;
      setLocalCode(template.code);
      setShowTemplates(false);
      setTimeout(() => textareaRef.current?.focus(), 0);
    },
    [markDirty],
  );

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
    // Save fullscreen changes back
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

  // issue 521: the block's own menu, and View Fullscreen from it, are
  // reachable in both modes, so what they offer must be what the user is
  // looking at — the session's code while editing, the committed attribute
  // otherwise.
  const menuCode = editing ? localCode : code;
  // Only hand out the rendered svg (Copy as SVG, the PNG items gated on it,
  // the fullscreen viewer) when it was rendered from that very source — never
  // a stale render over broken or newer source. The inline preview keeps
  // showing the last good render, faded, next to the error; that is the
  // editing affordance, not an export.
  const freshSvgHtml = renderedSource === menuCode ? svgHtml : "";
  const detectedType = detectMermaidType(localCode);

  // Fullscreen View modal (read-only — diagram only, no editor)
  const closeViewFullscreen = useCallback(() => {
    setViewFullscreen(false);
    // The modal is reachable from the block menu mid-edit now (issue 521);
    // blurring then would end the textarea session the user is in.
    if (editing) return;
    // Prevent ProseMirror from selecting the mermaid block when modal closes
    requestAnimationFrame(() => {
      editor.commands.blur();
    });
  }, [editor, editing]);

  const viewFullscreenModal = viewFullscreen ? (
    <MermaidViewFullscreenModal
      detectedType={detectedType}
      error={error}
      onClose={closeViewFullscreen}
      svgHtml={freshSvgHtml}
    />
  ) : null;

  // Fullscreen edit modal
  const fullscreenModal = fullscreen ? (
    <MermaidEditFullscreenModal
      detectedType={detectedType}
      fullscreenCode={fullscreenCode}
      fullscreenError={fullscreenError}
      fullscreenSvg={fullscreenSvg}
      fullscreenTextareaRef={fullscreenTextareaRef}
      onChangeCode={setFullscreenCode}
      onClose={closeFullscreen}
      onDiscard={discardFullscreen}
    />
  ) : null;

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
      // issue 521: right-click ownership goes by the ELEMENT under the
      // pointer, not by the block's mode. A native text control (the source
      // textarea, the caption input) is the browser's — let the event bubble
      // untouched and the document-level rule (ContextMenu.tsx) yields to the
      // native menu. Everything else on this block — the rendered diagram in
      // either mode, the header — opens the block's own menu. Attached in
      // BOTH modes: while editing, the live preview stays visible and used to
      // fall through to the generic text menu (Cut / Bold over an atom).
      onContextMenu={(e: React.MouseEvent) => {
        // Portal-borne events bubble here too: the fullscreen modals render
        // into body but live in this component's React tree. They are not
        // physically inside the block, and the menu they would open is bound
        // to the inline state, not the fullscreen draft — leave them to the
        // browser.
        if (!wrapperRef.current?.contains(e.target as Node)) return;
        if (isInNativeTextControl(e.target)) {
          // No menu of ours may linger beside the native one — not this
          // block's, not another block's, not the document-level one. Their
          // mousedown dismiss does not fire when the click that got here was
          // on the toolbar or the caption (both stop mousedown), nor for a
          // keyboard-invoked context menu.
          closeAllContextMenus();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        // One menu at a time: this block's right-button mousedown never
        // reached the others' dismiss listeners (stopped below), so say so.
        closeAllContextMenus();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
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
        <MermaidBlockHeader
          applyTemplate={applyTemplate}
          detectedType={detectedType}
          onOpenEditFullscreen={() => openEditFullscreen(localCode)}
          setShowTemplates={setShowTemplates}
          showTemplates={showTemplates}
        />
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
              ? "mermaid-block-textarea"
              : "mermaid-block-textarea mermaid-block-textarea-standby"
          }
          data-gramm="false"
          data-vim-suspend=""
          onChange={(e) => {
            markDirty();
            setLocalCode(e.target.value);
          }}
          placeholder="flowchart LR&#10;  A --> B"
          ref={textareaRef}
          rows={1}
          spellCheck={false}
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
        </>
      )}
      {contextMenu && (
        <MermaidBlockContextMenu
          code={menuCode}
          contextMenu={contextMenu}
          onClose={() => setContextMenu(null)}
          onDelete={deleteBlock}
          onOpenEditFullscreen={() => openEditFullscreen(menuCode)}
          setViewFullscreen={setViewFullscreen}
          svgHtml={freshSvgHtml}
        />
      )}
      {viewFullscreenModal}
      {fullscreenModal}
    </NodeViewWrapper>
  );
}
