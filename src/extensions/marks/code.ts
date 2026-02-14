// §5.1 Inline Code Mark Extension — `text`
import { Mark, mergeAttributes, markInputRule, markPasteRule } from "@tiptap/core";

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

  addOptions() {
    return { HTMLAttributes: {} };
  },

  parseHTML() {
    return [{ tag: "code" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["code", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setCode: () => ({ commands }) => commands.setMark(this.name),
      toggleCode: () => ({ commands }) => commands.toggleMark(this.name),
      unsetCode: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return { "Mod-e": () => this.editor.commands.toggleCode() };
  },

  addInputRules() {
    return [markInputRule({ find: inputRegex, type: this.type })];
  },

  addPasteRules() {
    return [markPasteRule({ find: pasteRegex, type: this.type })];
  },
});
