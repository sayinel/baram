// §5.1 Superscript Mark Extension — ^text^
import {
  Mark,
  markInputRule,
  markPasteRule,
  mergeAttributes,
} from "@tiptap/core";

import { htmlAttributesOptions } from "../utils/html-attributes-options";
import { makeMarkCommands } from "./make-mark-commands";

export interface SuperscriptOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    superscript: {
      setSuperscript: () => ReturnType;
      toggleSuperscript: () => ReturnType;
      unsetSuperscript: () => ReturnType;
    };
  }
}

const inputRegex = /(\^([^^]+)\^)$/;
const pasteRegex = /(\^([^^]+)\^)/g;

export const Superscript = Mark.create<SuperscriptOptions>({
  name: "superscript",

  ...htmlAttributesOptions,

  parseHTML() {
    return [{ tag: "sup" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "sup",
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
