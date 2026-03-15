// §5.1 Underline Mark Extension — <u>text</u>
import { Mark, markInputRule, mergeAttributes } from "@tiptap/core";

import { htmlAttributesOptions } from "../utils/html-attributes-options";
import { resolveShortcut } from "../utils/shortcut-resolver";
import { makeMarkCommands } from "./make-mark-commands";

export interface UnderlineOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    underline: {
      setUnderline: () => ReturnType;
      toggleUnderline: () => ReturnType;
      unsetUnderline: () => ReturnType;
    };
  }
}

export const Underline = Mark.create<UnderlineOptions>({
  name: "underline",

  ...htmlAttributesOptions,

  parseHTML() {
    return [
      { tag: "u" },
      {
        style: "text-decoration",
        consuming: false,
        getAttrs: (value) =>
          (value as string).includes("underline") ? {} : false,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "u",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return makeMarkCommands(this.name);
  },

  addInputRules() {
    // Detect <u>text</u> typed in WYSIWYG and convert to underline mark.
    // Uses Tiptap's markInputRule which properly handles addMark + removeStoredMark.
    return [
      markInputRule({
        find: /<u>([^<]+)<\/u>$/,
        type: this.type,
      }),
    ];
  },

  addKeyboardShortcuts() {
    const key = resolveShortcut("formatting.underline", "Mod-u");
    return { [key]: () => this.editor.commands.toggleUnderline() };
  },
});
