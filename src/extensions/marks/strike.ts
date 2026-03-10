// §5.1 Strikethrough Mark Extension — ~~text~~
import {
  Mark,
  markInputRule,
  markPasteRule,
  mergeAttributes,
} from "@tiptap/core";

export interface StrikeOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    strike: {
      setStrike: () => ReturnType;
      toggleStrike: () => ReturnType;
      unsetStrike: () => ReturnType;
    };
  }
}

const inputRegex = /(?:^|\s)(~~(?!\s+~~)((?:[^~]+))~~)$/;
const pasteRegex = /(?:^|\s)(~~(?!\s+~~)((?:[^~]+))~~)/g;

export const Strike = Mark.create<StrikeOptions>({
  name: "strike",

  addOptions() {
    return { HTMLAttributes: {} };
  },

  parseHTML() {
    return [
      { tag: "del" },
      { tag: "s" },
      {
        style: "text-decoration",
        consuming: false,
        getAttrs: (style) =>
          (style as string).includes("line-through") ? {} : false,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "del",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return {
      setStrike:
        () =>
        ({ commands }) =>
          commands.setMark(this.name),
      toggleStrike:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
      unsetStrike:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return { "Mod-Shift-x": () => this.editor.commands.toggleStrike() };
  },

  addInputRules() {
    return [markInputRule({ find: inputRegex, type: this.type })];
  },

  addPasteRules() {
    return [markPasteRule({ find: pasteRegex, type: this.type })];
  },
});
