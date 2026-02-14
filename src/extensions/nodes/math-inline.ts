// §5.3 Math Inline Node — atom:true, render-only (editing handled by MathInlineEdit plugin)
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MathInlineView } from "./math-inline-view";

export interface MathInlineOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mathInline: {
      setMathInline: (attrs: { formula: string }) => ReturnType;
    };
  }
}

export const MathInline = Node.create<MathInlineOptions>({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,

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
        tag: 'span[data-type="mathInline"]',
        getAttrs: (el) => ({
          formula: (el as HTMLElement).getAttribute("data-formula") || "",
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "mathInline",
        "data-formula": node.attrs.formula,
        "data-math-size": node.attrs.mathSize || "normal",
        class: "math-inline",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathInlineView);
  },

  addCommands() {
    return {
      setMathInline:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
