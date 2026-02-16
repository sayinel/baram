// §5.1 Underline Mark Extension — <u>text</u>
import { Mark, markInputRule, mergeAttributes } from "@tiptap/core";

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

  addOptions() {
    return { HTMLAttributes: {} };
  },

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
    return ["u", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setUnderline: () => ({ commands }) => commands.setMark(this.name),
      toggleUnderline: () => ({ commands }) => commands.toggleMark(this.name),
      unsetUnderline: () => ({ commands }) => commands.unsetMark(this.name),
    };
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
    return { "Mod-u": () => this.editor.commands.toggleUnderline() };
  },
});
