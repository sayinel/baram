// §5.1 Italic Mark Extension — *text*
import {
  Mark,
  markInputRule,
  markPasteRule,
  mergeAttributes,
} from "@tiptap/core";

import { htmlAttributesOptions } from "../utils/html-attributes-options";
import { resolveShortcut } from "../utils/shortcut-resolver";
import { makeMarkCommands } from "./make-mark-commands";

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

  ...htmlAttributesOptions,

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
    return makeMarkCommands(this.name);
  },

  addKeyboardShortcuts() {
    const key = resolveShortcut("formatting.italic", "Mod-i");
    return { [key]: () => this.editor.commands.toggleItalic() };
  },

  addInputRules() {
    return [markInputRule({ find: starInputRegex, type: this.type })];
  },

  addPasteRules() {
    return [markPasteRule({ find: starPasteRegex, type: this.type })];
  },
});
