// §5.1 Subscript Mark Extension — ~text~
import {
  Mark,
  markInputRule,
  markPasteRule,
  mergeAttributes,
} from "@tiptap/core";

import { htmlAttributesOptions } from "../utils/html-attributes-options";
import { makeMarkCommands } from "./make-mark-commands";

export interface SubscriptOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    subscript: {
      setSubscript: () => ReturnType;
      toggleSubscript: () => ReturnType;
      unsetSubscript: () => ReturnType;
    };
  }
}

// Single ~ only (exclude ~~ which is strikethrough)
// Use negative lookbehind (?<!~) instead of [^~] to avoid consuming the preceding character
const inputRegex = /(?<!~)(~([^~\s][^~]*)~)$/;
const pasteRegex = /(?<!~)(~([^~\s][^~]*)~)/g;

export const Subscript = Mark.create<SubscriptOptions>({
  name: "subscript",

  ...htmlAttributesOptions,

  parseHTML() {
    return [{ tag: "sub" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "sub",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return makeMarkCommands(this.name);
  },

  addInputRules() {
    return [markInputRule({ find: inputRegex, type: this.type })];
  },

  addPasteRules() {
    return [markPasteRule({ find: pasteRegex, type: this.type })];
  },
});
