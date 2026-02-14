// §5.1 Paragraph Extension (default block)
import { Node, mergeAttributes } from "@tiptap/core";

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

  parseHTML() {
    return [{ tag: "p" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["p", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },
});
