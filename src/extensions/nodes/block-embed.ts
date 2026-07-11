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
    // trackNodeViewPosition: keep the cached NodeView position fresh when an
    // edit above shifts this atom (e.g. merging table cells / typing above).
    // Without it, @tiptap/react's stale currentPos makes handleSelectionUpdate
    // reject a valid NodeSelection, so the block can't enter edit mode on click
    // until the doc is reopened. See math-block.ts for the full explanation.
    return ReactNodeViewRenderer(BlockEmbedView, {
      trackNodeViewPosition: true,
    });
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
