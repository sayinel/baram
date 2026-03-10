// §5.1 Paragraph Extension (default block)
import { mergeAttributes, Node } from "@tiptap/core";

export interface ParagraphOptions {
  HTMLAttributes: Record<string, string>;
}

export const Paragraph = Node.create<ParagraphOptions>({
  name: "paragraph",
  group: "block",
  content: "inline*",
  priority: 1000,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      blockId: { default: null, rendered: false },
    };
  },

  parseHTML() {
    return [{ tag: "p" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs.blockId
      ? { ...HTMLAttributes, "data-block-id": node.attrs.blockId as string }
      : HTMLAttributes;
    return ["p", mergeAttributes(this.options.HTMLAttributes, attrs), 0];
  },
});
