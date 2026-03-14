// §5.1 Highlight Mark Extension — ==text==
import {
  Mark,
  markInputRule,
  markPasteRule,
  mergeAttributes,
} from "@tiptap/core";

import { htmlAttributesOptions } from "../utils/html-attributes-options";
import { resolveShortcut } from "../utils/shortcut-resolver";
import { makeMarkCommands } from "./make-mark-commands";

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

  ...htmlAttributesOptions,

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
    return makeMarkCommands(this.name);
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
