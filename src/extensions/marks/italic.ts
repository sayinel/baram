// §5.1 Italic Mark Extension — *text*
import {
  Mark,
  mergeAttributes,
  markInputRule,
  markPasteRule,
} from "@tiptap/core";

export interface ItalicOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    italic: {
      setItalic: () => ReturnType;
      toggleItalic: () => ReturnType;
      unsetItalic: () => ReturnType;
    };
  }
}

const starInputRegex = /(?:^|\s)(\*(?!\s+\*)((?:[^*]+))\*)$/;
const starPasteRegex = /(?:^|\s)(\*(?!\s+\*)((?:[^*]+))\*)/g;

export const Italic = Mark.create<ItalicOptions>({
  name: "italic",

  addOptions() {
    return { HTMLAttributes: {} };
  },

  parseHTML() {
    return [
      { tag: "em" },
      {
        tag: "i",
        getAttrs: (el) =>
          (el as HTMLElement).style.fontStyle !== "normal" && null,
      },
      { style: "font-style=italic" },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "em",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return {
      setItalic:
        () =>
        ({ commands }) =>
          commands.setMark(this.name),
      toggleItalic:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
      unsetItalic:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return { "Mod-i": () => this.editor.commands.toggleItalic() };
  },

  addInputRules() {
    return [markInputRule({ find: starInputRegex, type: this.type })];
  },

  addPasteRules() {
    return [markPasteRule({ find: starPasteRegex, type: this.type })];
  },
});
