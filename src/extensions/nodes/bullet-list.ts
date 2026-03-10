// §5.1 Bullet List Extension
import { mergeAttributes, Node, wrappingInputRule } from "@tiptap/core";

export interface BulletListOptions {
  HTMLAttributes: Record<string, string>;
  itemTypeName: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    bulletList: {
      toggleBulletList: () => ReturnType;
    };
  }
}

export const BulletList = Node.create<BulletListOptions>({
  name: "bulletList",
  group: "block",
  content: "listItem+",

  addOptions() {
    return {
      HTMLAttributes: {},
      itemTypeName: "listItem",
    };
  },

  parseHTML() {
    return [{ tag: "ul" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "ul",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return {
      toggleBulletList:
        () =>
        ({ commands }) =>
          commands.toggleList(this.name, this.options.itemTypeName),
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-8": () => this.editor.commands.toggleBulletList(),
    };
  },

  addInputRules() {
    return [
      wrappingInputRule({
        find: /^\s*[-*+]\s$/,
        type: this.type,
      }),
    ];
  },
});
