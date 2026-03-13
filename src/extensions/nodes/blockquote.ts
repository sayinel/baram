// §5.1 Blockquote Extension
import { mergeAttributes, Node, wrappingInputRule } from "@tiptap/core";

import { htmlAttributesOptions } from "../utils/html-attributes-options";
import { resolveShortcut } from "../utils/shortcut-resolver";

export interface BlockquoteOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockquote: {
      setBlockquote: () => ReturnType;
      toggleBlockquote: () => ReturnType;
      unsetBlockquote: () => ReturnType;
    };
  }
}

export const Blockquote = Node.create<BlockquoteOptions>({
  name: "blockquote",
  group: "block",
  content: "block+",
  defining: true,

  ...htmlAttributesOptions,

  parseHTML() {
    return [{ tag: "blockquote" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "blockquote",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return {
      setBlockquote:
        () =>
        ({ commands }) =>
          commands.wrapIn(this.name),
      toggleBlockquote:
        () =>
        ({ commands }) =>
          commands.toggleWrap(this.name),
      unsetBlockquote:
        () =>
        ({ commands }) =>
          commands.lift(this.name),
    };
  },

  addKeyboardShortcuts() {
    const key = resolveShortcut("formatting.blockquote", "Mod-Shift-b");
    return {
      [key]: () => this.editor.commands.toggleBlockquote(),
    };
  },

  addInputRules() {
    return [
      wrappingInputRule({
        find: /^>\s$/,
        type: this.type,
      }),
    ];
  },
});
