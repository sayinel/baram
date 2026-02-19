// §30b Block Embed Extension — {{embed ((target#^blockId))}}
// §30c adds NodeView, onNavigate option
import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { BlockEmbedView } from "./block-embed-view";

export interface BlockEmbedOptions {
  onNavigate: (target: string, blockId: string) => void;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockEmbed: {
      insertBlockEmbed: (attrs: {
        target: string;
        blockId: string;
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

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      {
        "data-type": "block-embed",
        "data-target": HTMLAttributes.target,
        "data-block-id": HTMLAttributes.blockId,
        class: "block-embed",
      },
      `{{embed ((${HTMLAttributes.target}#^${HTMLAttributes.blockId}))}}`,
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
