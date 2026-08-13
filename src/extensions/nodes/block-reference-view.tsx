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
          src={previewSrc}
          style={{ height: preview.height, width: preview.width }}
        />
      ) : (
        text
      )}
    </NodeViewWrapper>
  );
}
