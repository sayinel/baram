// §5.13 Query Block Extension — ```query (atom:true)
import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { htmlAttributesOptions } from "../utils/html-attributes-options";
import { QueryBlockView } from "./query-block-view";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    queryBlock: {
      setQueryBlock: () => ReturnType;
    };
  }
}

export interface QueryBlockOptions {
  HTMLAttributes: Record<string, string>;
}

export const QueryBlock = Node.create<QueryBlockOptions>({
  name: "queryBlock",
  group: "block",
  atom: true,
  defining: true,

  ...htmlAttributesOptions,

  addAttributes() {
    return {
      query: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="queryBlock"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "queryBlock",
        class: "query-block",
      }),
    ];
  },

  addNodeView() {
    // trackNodeViewPosition: keep the cached NodeView position fresh when an
    // edit above shifts this atom (e.g. merging table cells / typing above).
    // Without it, @tiptap/react's stale currentPos makes handleSelectionUpdate
    // reject a valid NodeSelection, so the block can't enter edit mode on click
    // until the doc is reopened. See math-block.ts for the full explanation.
    return ReactNodeViewRenderer(QueryBlockView, {
      trackNodeViewPosition: true,
    });
  },

  addCommands() {
    return {
      setQueryBlock:
        () =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name, attrs: { query: "" } })
            .run(),
    };
  },
});
