// §5.1 Bold Mark Extension — **text**
import {
  Mark,
  markInputRule,
  markPasteRule,
  mergeAttributes,
} from "@tiptap/core";

import { htmlAttributesOptions } from "../utils/html-attributes-options";
import { resolveShortcut } from "../utils/shortcut-resolver";
import { makeMarkCommands } from "./make-mark-commands";

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

  ...htmlAttributesOptions,

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
    return makeMarkCommands(this.name);
  },

  addKeyboardShortcuts() {
    const key = resolveShortcut("formatting.bold", "Mod-b");
    return { [key]: () => this.editor.commands.toggleBold() };
  },

  addInputRules() {
    return [markInputRule({ find: starInputRegex, type: this.type })];
  },

  addPasteRules() {
    return [markPasteRule({ find: starPasteRegex, type: this.type })];
  },
});
