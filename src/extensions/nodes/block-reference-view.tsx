// §30c Block Reference NodeView — renders ((target#^blockId)) as inline chip
import { useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import type { BlockReferenceOptions } from "./block-reference";

export function BlockReferenceView({
  node,
  selected,
  extension,
}: NodeViewProps) {
  const { target, blockId, display } = node.attrs as {
    target: string;
    blockId: string;
    display: string | null;
  };

  // Display text priority: display > "target > ^blockId" > "^blockId"
  const text = display || (target ? `${target} > ^${blockId}` : `^${blockId}`);

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
      data-target={target}
      data-block-id={blockId}
      onClick={handleClick}
    >
      {text}
    </NodeViewWrapper>
  );
}
