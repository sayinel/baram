// §5.3 Math Block Extension — $$...$$
import { Node, mergeAttributes } from "@tiptap/core";
import { textblockTypeInputRule } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MathBlockView } from "./math-block-view";

export interface MathBlockOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mathBlock: {
      setMathBlock: () => ReturnType;
    };
  }
}

export const MathBlock = Node.create<MathBlockOptions>({
  name: "mathBlock",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  atom: false,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      formula: { default: "" },
      mathSize: { default: "normal" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="mathBlock"]',
        preserveWhitespace: "full" as const,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "mathBlock",
        "data-math-size": HTMLAttributes.mathSize || "normal",
        class: "math-block",
      }),
      ["code", 0],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathBlockView);
  },

  addCommands() {
    return {
      setMathBlock:
        () =>
        ({ commands }) =>
          commands.setNode(this.name),
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-m": () => this.editor.commands.setMathBlock(),
    };
  },

  addInputRules() {
    return [
      textblockTypeInputRule({
        find: /^\$\$[\s\n]$/,
        type: this.type,
      }),
    ];
  },
});
