// §30c Block Reference NodeView — renders ((target#^blockId)) as inline chip
import { useCallback } from "react";

import type { BlockReferenceOptions } from "./block-reference";
import type { NodeViewProps } from "@tiptap/react";

import { NodeViewWrapper } from "@tiptap/react";

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
      data-block-id={blockId}
      data-target={target}
      onClick={handleClick}
    >
      {text}
    </NodeViewWrapper>
  );
}
