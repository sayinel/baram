// §5.1 List Item Extension
import { Node, mergeAttributes } from "@tiptap/core";

export interface ListItemOptions {
  HTMLAttributes: Record<string, string>;
}

export const ListItem = Node.create<ListItemOptions>({
  name: "listItem",
  content: "paragraph block*",
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [{ tag: "li" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "li",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitListItem(this.name),
      Tab: () => this.editor.commands.sinkListItem(this.name),
      "Shift-Tab": () => this.editor.commands.liftListItem(this.name),
    };
  },
});
