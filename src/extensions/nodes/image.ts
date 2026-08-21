// §5.1 Image Extension (block-level) with §3.3 NodeView
import { InputRule, mergeAttributes, Node } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { classifyMediaSrc } from "../../utils/media-src";
import { createAtomMediaClickGuard } from "../plugins/atom-media-click-guard";
import { ImageView } from "./image-view";

export interface ImageOptions {
  allowBase64: boolean;
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    image: {
      setImage: (options: {
        alt?: string;
        src: string;
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

  addProseMirrorPlugins() {
    return [
      createAtomMediaClickGuard({
        nodeName: "image",
        wrapperClass: "image-node-view",
        excludeSelectors: [".media-toolbar", ".image-caption"],
        excludeTagNames: ["INPUT"],
      }),
    ];
  },

  addInputRules() {
    // ![alt](url) or ![alt](url "title") at start of line → replace with image block
    return [
      new InputRule({
        find: /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/,
        handler: ({ state, range, match }) => {
          const [, alt, src, title] = match;
          if (classifyMediaSrc(src) !== "image") return;

          const { tr } = state;
          const imageNode = this.type.create({
            src,
            alt: alt || null,
            title: title || null,
          });

          // Replace the entire parent paragraph (not just text positions)
          // to avoid leaving an empty paragraph remnant above the image.
          const $from = state.doc.resolve(range.from);
          const paraStart = $from.before($from.depth);
          const paraEnd = $from.after($from.depth);
          tr.replaceWith(paraStart, paraEnd, imageNode);

          // Ensure a paragraph exists after the image for the cursor
          const posAfterImage = paraStart + imageNode.nodeSize;
          if (!tr.doc.resolve(posAfterImage).nodeAfter?.isTextblock) {
            tr.insert(posAfterImage, state.schema.nodes.paragraph.create());
          }

          // Place cursor in the paragraph after the image
          tr.setSelection(TextSelection.create(tr.doc, posAfterImage + 1));
        },
      }),
    ];
  },
});
