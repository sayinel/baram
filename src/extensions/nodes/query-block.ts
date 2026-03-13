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
    return ReactNodeViewRenderer(QueryBlockView);
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
