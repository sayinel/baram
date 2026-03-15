// §5.1 Strikethrough Mark Extension — ~~text~~
import {
  Mark,
  markInputRule,
  markPasteRule,
  mergeAttributes,
} from "@tiptap/core";

import { htmlAttributesOptions } from "../utils/html-attributes-options";
import { resolveShortcut } from "../utils/shortcut-resolver";
import { makeMarkCommands } from "./make-mark-commands";

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

  ...htmlAttributesOptions,

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
    return makeMarkCommands(this.name);
  },

  addKeyboardShortcuts() {
    const key = resolveShortcut("formatting.strikethrough", "Mod-Shift-x");
    return { [key]: () => this.editor.commands.toggleStrike() };
  },

  addInputRules() {
    return [markInputRule({ find: inputRegex, type: this.type })];
  },

  addPasteRules() {
    return [markPasteRule({ find: pasteRegex, type: this.type })];
  },
});
