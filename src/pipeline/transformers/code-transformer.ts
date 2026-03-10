import type { MarkTransformerEntry } from "../types";
// code-transformer.ts — §5.1 Inline code mark mdast ↔ ProseMirror
import type { Mark } from "@tiptap/pm/model";
import type { Schema } from "@tiptap/pm/model";
import type { InlineCode, Node as MdastNode } from "mdast";

export const codeTransformer: MarkTransformerEntry = {
  mdastType: "inlineCode",
  pmMarkType: "code",

  mdastToMark(_node: MdastNode, schema: Schema) {
    return schema.marks.code.create();
  },

  markToMdast(_mark: Mark, children: MdastNode[]): MdastNode {
    // Inline code is a leaf in mdast (value, not children)
    const text = children
      .map((c) => ("value" in c ? (c as { value: string }).value : ""))
      .join("");
    return {
      type: "inlineCode",
      value: text,
    } as InlineCode;
  },
};
