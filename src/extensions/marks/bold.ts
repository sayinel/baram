// §5.1 Bold Mark Extension — **text**
import {
  Mark,
  mergeAttributes,
  markInputRule,
  markPasteRule,
} from "@tiptap/core";

export interface BoldOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    bold: {
      setBold: () => ReturnType;
      toggleBold: () => ReturnType;
      unsetBold: () => ReturnType;
    };
  }
}

// **text** or __text__
const starInputRegex = /(?:^|\s)(\*\*(?!\s+\*\*)((?:[^*]+))\*\*)$/;
const starPasteRegex = /(?:^|\s)(\*\*(?!\s+\*\*)((?:[^*]+))\*\*)/g;

export const Bold = Mark.create<BoldOptions>({
  name: "bold",

  addOptions() {
    return { HTMLAttributes: {} };
  },

  parseHTML() {
    return [
      { tag: "strong" },
      {
        tag: "b",
        getAttrs: (el) =>
          (el as HTMLElement).style.fontWeight !== "normal" && null,
      },
      { style: "font-weight=bold" },
      { style: "font-weight=700" },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "strong",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return {
      setBold:
        () =>
        ({ commands }) =>
          commands.setMark(this.name),
      toggleBold:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
      unsetBold:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return { "Mod-b": () => this.editor.commands.toggleBold() };
  },

  addInputRules() {
    return [markInputRule({ find: starInputRegex, type: this.type })];
  },

  addPasteRules() {
    return [markPasteRule({ find: starPasteRegex, type: this.type })];
  },
});
