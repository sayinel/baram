// §5.1 Inline Code Mark Extension — `text`
import {
  Mark,
  markInputRule,
  markPasteRule,
  mergeAttributes,
} from "@tiptap/core";

import { htmlAttributesOptions } from "../utils/html-attributes-options";
import { resolveShortcut } from "../utils/shortcut-resolver";
import { makeMarkCommands } from "./make-mark-commands";

export interface CodeOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    code: {
      setCode: () => ReturnType;
      toggleCode: () => ReturnType;
      unsetCode: () => ReturnType;
    };
  }
}

const inputRegex = /(?:^|[^`])(`(?!\s+`)((?:[^`]+))`(?!`))$/;
const pasteRegex = /(?:^|[^`])(`(?!\s+`)((?:[^`]+))`(?!`))/g;

export const Code = Mark.create<CodeOptions>({
  name: "code",
  excludes: "_", // §7.2: code는 모든 다른 mark와 배타적

  ...htmlAttributesOptions,

  parseHTML() {
    return [{ tag: "code" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "code",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return makeMarkCommands(this.name);
  },

  addKeyboardShortcuts() {
    const key = resolveShortcut("formatting.inlineCode", "Mod-e");
    return { [key]: () => this.editor.commands.toggleCode() };
  },

  addInputRules() {
    return [markInputRule({ find: inputRegex, type: this.type })];
  },

  addPasteRules() {
    return [markPasteRule({ find: pasteRegex, type: this.type })];
  },
});
