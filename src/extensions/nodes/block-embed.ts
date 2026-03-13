// §30b Block Embed Extension — {{embed ((target#^blockId))}}
// §30c adds NodeView, onNavigate option
import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { BlockEmbedView } from "./block-embed-view";

export interface BlockEmbedOptions {
  HTMLAttributes: Record<string, string>;
  onNavigate: (target: string, blockId: string) => void;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockEmbed: {
      insertBlockEmbed: (attrs: {
        blockId: string;
        target: string;
      }) => ReturnType;
    };
  }
}

export const BlockEmbed = Node.create<BlockEmbedOptions>({
  name: "blockEmbed",
  group: "block",
  atom: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      onNavigate: () => {},
    };
  },

  addAttributes() {
    return {
      target: { default: "" },
      blockId: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="block-embed"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "block-embed",
        "data-target": node.attrs.target,
        "data-block-id": node.attrs.blockId,
        class: "block-embed",
      }),
      `{{embed ((${node.attrs.target}#^${node.attrs.blockId}))}}`,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockEmbedView);
  },

  addCommands() {
    return {
      insertBlockEmbed:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
          }),
    };
  },
});
