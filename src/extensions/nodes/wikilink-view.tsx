// §28 Wikilink NodeView — renders [[target]] as styled inline link
import { useCallback } from "react";

import type { WikilinkOptions } from "./wikilink";
import type { NodeViewProps } from "@tiptap/react";

import { NodeViewWrapper } from "@tiptap/react";

import { isDateString } from "../../utils/journal/journal";

export function WikilinkView({ node, selected, extension }: NodeViewProps) {
  const { target, display, heading } = node.attrs as {
    display: null | string;
    heading: null | string;
    target: string;
  };

  // Display text priority: display > heading > target
  const text = display || (heading ? `${target} > ${heading}` : target);

  const isDate = isDateString(target);

  // §28 Cmd+Click navigates to target document
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // §56 Date wikilinks navigate on single click
      if (isDate || e.metaKey || e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        const onNavigate = (extension.options as WikilinkOptions).onNavigate;
        onNavigate(target, heading);
      }
    },
    [extension, target, heading, isDate],
  );

  return (
    <NodeViewWrapper
      as="span"
      className={`wikilink ${selected ? "wikilink-selected" : ""}${isDate ? "wikilink-date" : ""}`}
      data-target={target}
      onClick={handleClick}
    >
      {isDate && <span className="wikilink-date-icon">📅</span>}
      {text}
    </NodeViewWrapper>
  );
}
