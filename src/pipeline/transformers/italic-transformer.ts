import type { MarkTransformerEntry } from "../types";
// italic-transformer.ts — §5.1 Italic mark mdast ↔ ProseMirror
import type { Mark } from "@tiptap/pm/model";
import type { Schema } from "@tiptap/pm/model";
import type { Emphasis, Node as MdastNode, PhrasingContent } from "mdast";

export const italicTransformer: MarkTransformerEntry = {
  mdastType: "emphasis",
  pmMarkType: "italic",

  mdastToMark(_node: MdastNode, schema: Schema) {
    return schema.marks.italic.create();
  },

  markToMdast(_mark: Mark, children: MdastNode[]): MdastNode {
    return {
      type: "emphasis",
      children: children as PhrasingContent[],
    } as Emphasis;
  },
};
