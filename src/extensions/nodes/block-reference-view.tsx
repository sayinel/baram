// §30c Block Reference NodeView — renders ((target#^blockId)) as inline chip
// §276.4 …except when the ref points at an AREA highlight, where it renders the
// cropped PDF region itself.
// §276.5 …and when it points at a TEXT highlight, where it renders the full
// original sentence from the companion note instead of the truncated `display`
// label that was baked into the markdown at copy time.
//
// Both are display-time affordances only: the markdown on disk is the same
// `((target#^blockId|display))` in every branch.
import { useCallback } from "react";

import type { BlockReferenceOptions } from "./block-reference";
import type { NodeViewProps } from "@tiptap/react";

import { NodeViewWrapper } from "@tiptap/react";

import { usePdfHighlightRefPreview } from "../../components/editor/pdf/use-pdf-highlight-ref-preview";

export function BlockReferenceView({
  node,
  selected,
  extension,
}: NodeViewProps) {
  const { target, blockId, display } = node.attrs as {
    blockId: string;
    display: null | string;
    target: string;
  };

  // Display text priority: display > "target > ^blockId" > "^blockId"
  const text = display || (target ? `${target} > ^${blockId}` : `^${blockId}`);

  // §276.4/§276.5 Everything but "ready" keeps the text chip — including while
  // the preview is still loading, so the line doesn't reflow twice.
  const preview = usePdfHighlightRefPreview(target, blockId);
  const ready = preview.status === "ready";
  const previewSrc = ready && preview.kind === "area" ? preview.src : null;
  const fullText = ready && preview.kind === "text" ? preview.text : null;

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
      className={`block-reference ${selected ? "block-reference-selected" : ""}`}
      // Lets links.css switch off the chip's background/border/padding — the
      // crop is the content now, and a chip frame around it reads as a bug.
      // The TEXT branch keeps the chip: it is still a run of words, and the
      // frame is what marks it as a reference rather than prose.
      data-area-preview={previewSrc ? "true" : undefined}
      data-block-id={blockId}
      data-target={target}
      onClick={handleClick}
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
    </NodeViewWrapper>
  );
}
