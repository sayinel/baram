// §30c Block Reference NodeView — renders ((target#^blockId)) as inline chip
// §276.4 …except when the ref points at an AREA highlight, where it renders the
// cropped PDF region itself. That is a display-time affordance only: the
// markdown on disk is the same `((target#^blockId|display))` either way.
import { useCallback } from "react";

import type { BlockReferenceOptions } from "./block-reference";
import type { NodeViewProps } from "@tiptap/react";

import { NodeViewWrapper } from "@tiptap/react";

import { usePdfAreaRefPreview } from "../../components/editor/pdf/use-pdf-area-ref-preview";

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

  // §276.4 Everything but "ready" keeps the text chip — including while the
  // crop is still rendering, so the line doesn't reflow twice.
  const preview = usePdfAreaRefPreview(target, blockId);
  const previewSrc = preview.status === "ready" ? preview.src : null;

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
        text
      )}
    </NodeViewWrapper>
  );
}
