// §5.1 Table of Contents Node Extension — [TOC]
import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { htmlAttributesOptions } from "../utils/html-attributes-options";
import { TableOfContentsView } from "./table-of-contents-view";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    tableOfContents: {
      insertTableOfContents: () => ReturnType;
    };
  }
}

export interface TableOfContentsOptions {
  HTMLAttributes: Record<string, string>;
}

export const TableOfContents = Node.create<TableOfContentsOptions>({
  name: "tableOfContents",
  group: "block",
  atom: true,

  ...htmlAttributesOptions,

  parseHTML() {
    return [{ tag: 'div[data-type="table-of-contents"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "table-of-contents",
      }),
      "[TOC]",
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TableOfContentsView);
  },

  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    };
  },
});
