// §30b Block Reference Extension — ((target#^blockId)) or ((target#^blockId|display))
// §30c adds NodeView, onNavigate option, Cmd+click plugin
import { Node } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { BlockReferenceView } from "./block-reference-view";

export interface BlockReferenceOptions {
  onNavigate: (target: string, blockId: string) => void;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockReference: {
      insertBlockReference: (attrs: {
        target: string;
        blockId: string;
        display?: string | null;
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

  renderHTML({ HTMLAttributes }) {
    const display =
      HTMLAttributes.display ||
      `${HTMLAttributes.target}#^${HTMLAttributes.blockId}`;
    return [
      "span",
      {
        "data-type": "block-reference",
        "data-target": HTMLAttributes.target,
        "data-block-id": HTMLAttributes.blockId,
        "data-display": HTMLAttributes.display || "",
        class: "block-reference",
      },
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
    const extension = this;
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

            extension.options.onNavigate(
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
