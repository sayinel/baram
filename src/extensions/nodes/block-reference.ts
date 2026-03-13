// §30b Block Reference Extension — ((target#^blockId)) or ((target#^blockId|display))
// §30c adds NodeView, onNavigate option, Cmd+click plugin
import { mergeAttributes, Node } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { BlockReferenceView } from "./block-reference-view";

export interface BlockReferenceOptions {
  HTMLAttributes: Record<string, string>;
  onNavigate: (target: string, blockId: string) => void;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockReference: {
      insertBlockReference: (attrs: {
        blockId: string;
        display?: null | string;
        target: string;
      }) => ReturnType;
    };
  }
}

export const BlockReference = Node.create<BlockReferenceOptions>({
  name: "blockReference",
  group: "inline",
  inline: true,
  atom: true,
  marks: "",

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
      display: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="block-reference"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const display =
      node.attrs.display || `${node.attrs.target}#^${node.attrs.blockId}`;
    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "block-reference",
        "data-target": node.attrs.target,
        "data-block-id": node.attrs.blockId,
        "data-display": node.attrs.display || "",
        class: "block-reference",
      }),
      display,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlockReferenceView);
  },

  addCommands() {
    return {
      insertBlockReference:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
          }),
    };
  },

  // Cmd+click navigates to the block reference target
  addProseMirrorPlugins() {
    const { onNavigate } = this.options;
    return [
      new Plugin({
        props: {
          handleClick(view, pos, event) {
            if (!(event.metaKey || event.ctrlKey)) return false;

            const { state } = view;
            const node = state.doc.nodeAt(pos);
            const resolved = state.doc.resolve(pos);

            const refNode =
              node?.type.name === "blockReference"
                ? node
                : resolved.parent?.type.name === "blockReference"
                  ? resolved.parent
                  : null;

            if (!refNode) return false;

            onNavigate(
              refNode.attrs.target as string,
              refNode.attrs.blockId as string,
            );
            return true;
          },
        },
      }),
    ];
  },
});
