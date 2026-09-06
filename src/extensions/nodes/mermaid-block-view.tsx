import { useCallback, useEffect, useRef, useState } from "react";

import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
// §5.5 Mermaid Block NodeView — selected: textarea + preview, unselected: SVG render
// §50 Enhanced: template picker + full-screen edit
import { Captions, Copy, Download, Maximize2, Sparkles } from "lucide-react";

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
import { runBlockAction } from "./views/run-block-action";
import { useAtomBlockBehavior } from "./views/use-atom-block-behavior";
import { useAtomEditSession } from "./views/use-atom-edit-session";
import { useBlockContextMenu } from "./views/use-block-context-menu";
import { useInnerHtml } from "./views/use-inner-html";
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
  // The rendered svg TOGETHER with the source it was rendered from — one
  // state, so the two cannot drift apart. The render is debounced and a
  // failed render keeps the last good svg, so while editing the source on
  // screen and the svg can disagree; anything that hands the svg out (the
  // block menu, the fullscreen viewer) checks the pairing first (issue 521
  // final review).
  const [rendered, setRendered] = useState({ source: "", svg: "" });
  const svgHtml = rendered.svg;
  const renderedSource = rendered.source;
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
      setRendered({ source, svg: "" });
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
              setRendered({ source, svg });
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

  // What the block's chrome acts on — the session's code while editing, the
  // committed attribute otherwise. The menu, View Fullscreen from it and the
  // toolbar's copy/download all read this, never the raw attribute (issue
  // 521: the menu is reachable mid-edit, and must offer what is on screen).
  const activeSource = editing ? localCode : code;
  // Only hand out the rendered svg (Copy as SVG, the PNG items gated on it,
  // the fullscreen viewer) when it was rendered from that very source — never
  // a stale render over broken or newer source. The inline preview keeps
  // showing the last good render, faded, next to the error; that is the
  // editing affordance, not an export.
  const freshSvgHtml = renderedSource === activeSource ? svgHtml : "";
  // Why the svg items are unavailable, when they are: shown on the disabled
  // items and the fullscreen viewer rather than by hiding them, so the menu
  // does not reshape when a render lands. Undefined for an empty source —
  // nothing to offer at all.
  const svgUnavailableReason = freshSvgHtml
    ? undefined
    : error
      ? "Diagram does not render"
      : activeSource.trim()
        ? "Rendering…"
        : undefined;

  // issue 521: the block's own right-click menu — ownership by target, one
  // menu at a time, closed by a mode or source change. use-block-context-menu.ts.
  const {
    close: closeBlockMenu,
    contextMenu,
    onContextMenu: handleBlockContextMenu,
    menuRef: blockMenuRef,
    onMouseDown: stopRightButtonMouseDown,
  } = useBlockContextMenu({ editing, source: activeSource, wrapperRef });

  // Seed the fullscreen editor and open it. Two call sites share this
  // code→svg→error→open sequence (the header's Expand button and the block's
  // context menu's Edit Fullscreen item) — collapsed into one action. They
  // differ only in WHICH code string they seed (the header always has an
  // open edit session so it seeds `localCode`; the context menu is reachable
  // in both modes since issue 521 and seeds `activeSource`), so that stays a
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

  const detectedType = detectMermaidType(localCode);

  // Fullscreen View modal (read-only — diagram only, no editor)
  const closeViewFullscreen = useCallback(() => {
    setViewFullscreen(false);
    // Prevent ProseMirror from selecting the mermaid block when modal closes
    requestAnimationFrame(() => {
      editor.commands.blur();
    });
  }, [editor]);

  // issue 549: one object per string for the markup this view injects
  // itself, or React 19 re-seeds the svg DOM on every render
  // (use-inner-html.ts). The modals memoise their own at their sink. useMemo
  // only — registers no effect, so the effect order this file relies on is
  // untouched wherever this sits.
  const svgMarkup = useInnerHtml(svgHtml);

  const viewFullscreenModal = viewFullscreen ? (
    <MermaidViewFullscreenModal
      detectedType={detectedType}
      error={error}
      onClose={closeViewFullscreen}
      pending={svgUnavailableReason === "Rendering…"}
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
      onContextMenu={handleBlockContextMenu}
      onMouseDown={stopRightButtonMouseDown}
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
              dangerouslySetInnerHTML={svgMarkup}
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
                    dangerouslySetInnerHTML={svgMarkup}
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
                onClick={() => copyMermaidSource(activeSource)}
                title="Copy source code"
              >
                <Copy size={16} strokeWidth={2} />
              </MediaToolbarButton>
              <MediaToolbarButton
                onClick={() =>
                  runBlockAction("Mermaid block", "download PNG", () =>
                    downloadMermaidPng(activeSource),
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
      {contextMenu && (
        <MermaidBlockContextMenu
          code={activeSource}
          contextMenu={contextMenu}
          menuRef={blockMenuRef}
          onClose={closeBlockMenu}
          onDelete={deleteBlock}
          onOpenEditFullscreen={() => openEditFullscreen(activeSource)}
          setViewFullscreen={setViewFullscreen}
          svgHtml={freshSvgHtml}
          svgUnavailableReason={svgUnavailableReason}
        />
      )}
      {viewFullscreenModal}
      {fullscreenModal}
    </NodeViewWrapper>
  );
}
