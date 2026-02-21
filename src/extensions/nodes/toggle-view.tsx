// §5.1 Toggle NodeView — collapsible <details>/<summary> block
import React, { useCallback } from "react";
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";

export const ToggleView: React.FC<NodeViewProps> = ({
  node,
  updateAttributes,
}) => {
  const isOpen = node.attrs.open as boolean;

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      updateAttributes({ open: !isOpen });
    },
    [isOpen, updateAttributes],
  );

  return (
    <NodeViewWrapper
      data-type="toggle"
      data-open={isOpen ? "true" : "false"}
      className="toggle"
    >
      <div
        className="toggle-indicator"
        contentEditable={false}
        onClick={handleToggle}
        role="button"
        tabIndex={-1}
        aria-expanded={isOpen}
        aria-label={isOpen ? "Collapse" : "Expand"}
      >
        <span className={`toggle-arrow ${isOpen ? "toggle-arrow-open" : ""}`} />
      </div>
      <NodeViewContent
        className={`toggle-body${!isOpen ? " toggle-body-collapsed" : ""}`}
      />
    </NodeViewWrapper>
  );
};
