// §28 Wikilink NodeView — renders [[target]] as styled inline link
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";

export function WikilinkView({ node, selected }: NodeViewProps) {
  const { target, display, heading } = node.attrs as {
    target: string;
    display: string | null;
    heading: string | null;
  };

  // Display text priority: display > heading > target
  const text = display || (heading ? `${target} > ${heading}` : target);

  return (
    <NodeViewWrapper
      as="span"
      className={`wikilink ${selected ? "wikilink-selected" : ""}`}
    >
      {text}
    </NodeViewWrapper>
  );
}
