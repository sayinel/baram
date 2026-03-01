// §56m Tag NodeView — renders #tag as styled inline pill
import { useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useSettingsStore } from "../../stores/settings-store";

export function TagNodeView({ node, selected }: NodeViewProps) {
  const tag = (node.attrs.tag as string) || "";
  const tagColor = useSettingsStore((s) => s.tagColors)[tag];

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(
          new CustomEvent("baram:search-query", { detail: { query: `#${tag}` } }),
        );
      }
    },
    [tag],
  );

  return (
    <NodeViewWrapper
      as="span"
      className={`tag-node ${selected ? "tag-node-selected" : ""}`}
      data-tag={tag}
      onClick={handleClick}
      title={`#${tag} (Cmd+Click to search)`}
      style={{ color: tagColor || undefined }}
    >
      <span className="tag-node-hash">#</span>
      {tag}
    </NodeViewWrapper>
  );
}
