// §5.1 Highlight Mark Extension — ==text==
import {
  Mark,
  markInputRule,
  markPasteRule,
  mergeAttributes,
} from "@tiptap/core";

import { resolveShortcut } from "../utils/shortcut-resolver";

export interface HighlightOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    highlight: {
      setHighlight: () => ReturnType;
      toggleHighlight: () => ReturnType;
      unsetHighlight: () => ReturnType;
    };
  }
}

const inputRegex = /(?:^|\s)(==(?!\s+==)((?:[^=]+))==)$/;
const pasteRegex = /(?:^|\s)(==(?!\s+==)((?:[^=]+))==)/g;

export const Highlight = Mark.create<HighlightOptions>({
  name: "highlight",

  addOptions() {
    return { HTMLAttributes: {} };
  },

  parseHTML() {
    return [{ tag: "mark" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "mark",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return {
      setHighlight:
        () =>
        ({ commands }) =>
          commands.setMark(this.name),
      toggleHighlight:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
      unsetHighlight:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    const key = resolveShortcut("formatting.highlight", "Mod-Shift-h");
    return { [key]: () => this.editor.commands.toggleHighlight() };
  },

  addInputRules() {
    return [markInputRule({ find: inputRegex, type: this.type })];
  },

  addPasteRules() {
    return [markPasteRule({ find: pasteRegex, type: this.type })];
  },
});
