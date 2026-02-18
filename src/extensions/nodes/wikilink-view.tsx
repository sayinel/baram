// §28 Wikilink NodeView — renders [[target]] as styled inline link
import { useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import type { WikilinkOptions } from "./wikilink";

export function WikilinkView({ node, selected, extension }: NodeViewProps) {
  const { target, display, heading } = node.attrs as {
    target: string;
    display: string | null;
    heading: string | null;
  };

  // Display text priority: display > heading > target
  const text = display || (heading ? `${target} > ${heading}` : target);

  // §28 Cmd+Click navigates to target document
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        const onNavigate = (extension.options as WikilinkOptions).onNavigate;
        onNavigate(target, heading);
      }
    },
    [extension, target, heading],
  );

  return (
    <NodeViewWrapper
      as="span"
      className={`wikilink ${selected ? "wikilink-selected" : ""}`}
      onClick={handleClick}
    >
      {text}
    </NodeViewWrapper>
  );
}
