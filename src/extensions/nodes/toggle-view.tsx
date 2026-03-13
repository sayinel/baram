// §5.1 Toggle NodeView — collapsible <details>/<summary> block
import React, { useCallback } from "react";

import type { NodeViewProps } from "@tiptap/react";

import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";

export const ToggleView: React.FC<NodeViewProps> = ({
  node,
  updateAttributes,
}) => {
  const isOpen = node.attrs.open as boolean;

  // Detect if first child is a heading (toggle heading)
  const firstChild = node.firstChild;
  const isHeadingSummary = firstChild?.type.name === "heading";
  const headingLevel = isHeadingSummary
    ? (firstChild!.attrs.level as number)
    : undefined;

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
      data-open={isOpen ? "true" : "false"}
      data-type="toggle"
      {...(isHeadingSummary
        ? {
            "data-summary-type": "heading",
            "data-summary-level": String(headingLevel),
          }
        : {})}
      className="toggle"
    >
      <div
        aria-expanded={isOpen}
        aria-label={isOpen ? "Collapse" : "Expand"}
        className="toggle-indicator"
        contentEditable={false}
        onClick={handleToggle}
        role="button"
        tabIndex={-1}
      >
        <span className={`toggle-arrow ${isOpen ? "toggle-arrow-open" : ""}`} />
      </div>
      <NodeViewContent
        className={`toggle-body${!isOpen ? "toggle-body-collapsed" : ""}`}
      />
    </NodeViewWrapper>
  );
};
