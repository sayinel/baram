// §57 Mention NodeView — renders @[[value]] as styled inline chip
import { useCallback } from "react";

import type { MentionOptions } from "./mention";
import type { NodeViewProps } from "@tiptap/react";

import { NodeViewWrapper } from "@tiptap/react";

export function MentionView({ node, selected, extension }: NodeViewProps) {
  const { type: mentionType, value } = node.attrs as {
    type: string;
    value: string;
  };

  const isDate = mentionType === "date";

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Date mentions navigate on single click; page mentions require Cmd/Ctrl
      if (isDate || e.metaKey || e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        const onNavigate = (extension.options as MentionOptions).onNavigate;
        onNavigate(mentionType, value);
      }
    },
    [extension, mentionType, value, isDate],
  );

  return (
    <NodeViewWrapper
      as="span"
      className={`mention mention-${mentionType}${selected ? "mention-selected" : ""}`}
      data-mention-type={mentionType}
      data-value={value}
      onClick={handleClick}
    >
      <span className="mention-icon">
        {isDate ? "\uD83D\uDCC5" : "\uD83D\uDCC4"}
      </span>
      <span className="mention-label text-truncate">{value}</span>
    </NodeViewWrapper>
  );
}
