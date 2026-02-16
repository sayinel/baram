// §5.1 Image Extension (block-level) with §3.3 NodeView
import { Node, mergeAttributes, InputRule } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ImageView } from "./image-view";

export interface ImageOptions {
  HTMLAttributes: Record<string, string>;
  allowBase64: boolean;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    image: {
      setImage: (options: {
        src: string;
        alt?: string;
        title?: string;
      }) => ReturnType;
    };
  }
}

export const Image = Node.create<ImageOptions>({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      allowBase64: false,
    };
  },

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      widthPercent: { default: 100 },
    };
  },

  parseHTML() {
    return [{ tag: "img[src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "img",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },

  addCommands() {
    return {
      setImage:
        (options) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: options,
          }),
    };
  },

  addInputRules() {
    // ![alt](url) or ![alt](url "title") at start of line → replace with image block
    return [
      new InputRule({
        find: /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/,
        handler: ({ state, range, match }) => {
          const [, alt, src, title] = match;
          const { tr } = state;
          tr.replaceWith(range.from, range.to, this.type.create({
            src,
            alt: alt || null,
            title: title || null,
          }));
        },
      }),
    ];
  },
});
