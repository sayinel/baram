// §30c Block Reference NodeView — renders ((target#^blockId)) as inline chip
// §276.4 …except when the ref points at an AREA highlight, where it renders the
// cropped PDF region itself.
// §276.5 …and when it points at a TEXT highlight, where it renders the full
// original sentence from the companion note instead of the truncated `display`
// label that was baked into the markdown at copy time.
//
// Both are display-time affordances only: the markdown on disk is the same
// `((target#^blockId|display))` in every branch.
//
// §276.6 …with one exception. An area preview can be resized by dragging its
// right edge, and that width IS written to the markdown — `|w=NN` — because
// the same crop wants a different size in different notes.
import { useCallback, useRef } from "react";

import type { BlockReferenceOptions } from "./block-reference";
import type { NodeViewProps } from "@tiptap/react";

import { NodeViewWrapper } from "@tiptap/react";

import { usePdfHighlightRefPreview } from "../../components/editor/pdf/use-pdf-highlight-ref-preview";
import { isInsideTableCell } from "./views/table-cell-position";
import { useInlineResize } from "./views/use-inline-resize";

export function BlockReferenceView({
  node,
  selected,
  extension,
  editor,
  getPos,
  updateAttributes,
}: NodeViewProps) {
  const { target, blockId, display, width } = node.attrs as {
    blockId: string;
    display: null | string;
    target: string;
    width: null | number;
  };

  // Display text priority: display > "target > ^blockId" > "^blockId"
  const text = display || (target ? `${target} > ^${blockId}` : `^${blockId}`);

  // §276.4/§276.5 Everything but "ready" renders `display`. For a highlight ref
  // that means the label is painted first and replaced once the preview lands,
  // two IPC round trips later (sidecar, then the crop or the companion note) —
  // one reflow per ref, on every document open and every tab switch, since
  // `view.updateState()` recreates all NodeViews. Showing the label rather than
  // nothing is what keeps the ref readable and clickable throughout.
  const preview = usePdfHighlightRefPreview(target, blockId);
  const ready = preview.status === "ready";
  const previewSrc = ready && preview.kind === "area" ? preview.src : null;
  // ‼️ Blank is treated as absent, not just null. The hook already rejects a
  // whitespace-only paragraph, but if that check ever regressed, rendering the
  // blank string would produce an empty chip with nothing to click — a ref the
  // user cannot even see, let alone navigate. The `display` label is always the
  // better fallback, so the guard is repeated at the point of render.
  const storedText = ready && preview.kind === "text" ? preview.text : null;
  const fullText =
    storedText && storedText.trim().length > 0 ? storedText : null;

  // §276.6 Resize is keyed off `previewSrc`, i.e. off the branch that actually
  // paints the crop — not off `kind === "area"` alone. A handle on a chip that
  // is still loading (or on the text branch, or on a plain block reference)
  // would let a drag write `|w=NN` into markdown for a reference that has no
  // rendered size to speak of.
  //
  // …and never inside a table cell, whatever the preview says: the `|` the
  // width is written with splits the GFM cell and destroys both the reference
  // and the table on the next round trip (table-cell-position.ts).
  const pos = getPos();
  const resizable =
    previewSrc != null &&
    (pos == null || !isInsideTableCell(editor.state.doc, pos));
  const wrapperRef = useRef<HTMLElement | null>(null);
  const { dragPct, startResize } = useInlineResize(wrapperRef, (pct) => {
    // Re-checked HERE, not only at render: the preview can flip away from
    // "ready" while the button is held (a re-resolve, a vault change), and a
    // drag that started on a legitimate crop would otherwise still write
    // `|w=NN` on mouseup — the exact write the render-time guard exists to
    // prevent. The hook re-reads this callback at commit time.
    if (!resizable) return;
    updateAttributes({ width: pct });
  });
  // The drag repaints from `dragPct` alone — the attribute (and the markdown)
  // is only written on mouseup, so a drag costs no transactions.
  const effectiveWidth = previewSrc ? (dragPct ?? width) : null;

  // Cmd+Click navigates to block
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        const onNavigate = (extension.options as BlockReferenceOptions)
          .onNavigate;
        onNavigate(target, blockId);
      }
    },
    [extension, target, blockId],
  );

  return (
    <NodeViewWrapper
      as="span"
      className={`block-reference ${selected ? "block-reference-selected" : ""} ${
        // The handle's reveal is :hover-gated, and an inline crop is small
        // enough that dragging left or below it drops hover — the grip would
        // vanish under the cursor mid-gesture. This keeps it painted for the
        // duration of the drag.
        dragPct == null ? "" : "is-resizing"
      }`}
      // Lets links.css switch off the chip's background/border/padding — the
      // crop is the content now, and a chip frame around it reads as a bug.
      // The TEXT branch keeps the chip: it is still a run of words, and the
      // frame is what marks it as a reference rather than prose.
      data-area-preview={previewSrc ? "true" : undefined}
      data-block-id={blockId}
      // links.css keys the crop's `width: 100%` off this: the wrapper carries
      // the percentage, and the image only fills it when there IS one —
      // otherwise a natural-size crop would stretch to the paragraph.
      data-sized={effectiveWidth == null ? undefined : "true"}
      data-target={target}
      onClick={handleClick}
      ref={wrapperRef}
      style={
        effectiveWidth == null ? undefined : { width: `${effectiveWidth}%` }
      }
    >
      {previewSrc ? (
        <img
          alt={text}
          className="block-reference-area-image"
          // Native image dragging would start a drag ProseMirror never asked
          // for; the Cmd+Click handler above still fires because the click
          // bubbles from the <img> to this wrapper.
          draggable={false}
          // ‼️ ATTRIBUTES, not inline style. An inline `style` declaration
          // outranks the class rule, so `.block-reference-area-image
          // { height: auto }` (links.css) could never apply and a preview
          // wider than the editor column got squashed at its pinned pixel
          // height. As attributes these only set the intrinsic aspect ratio,
          // which `max-width: 100%` + `height: auto` are then free to scale.
          height={preview.height}
          src={previewSrc}
          width={preview.width}
        />
      ) : (
        (fullText ?? text)
      )}
      {resizable && (
        <>
          {/* §276.6 Right edge only: the left edge is pinned by the text the
              reference sits in, so a left handle could only move the crop, not
              size it. A <span>, not the <div> the media blocks use — this is
              inline content inside a paragraph. */}
          <span
            className="media-resize-handle media-resize-handle-right"
            onMouseDown={startResize}
            title="Drag to resize"
          />
          {dragPct != null && (
            <span className="media-resize-label">{dragPct}%</span>
          )}
        </>
      )}
    </NodeViewWrapper>
  );
}
