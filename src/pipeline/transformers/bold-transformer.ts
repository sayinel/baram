import type { MarkTransformerEntry } from "../types";
// bold-transformer.ts — §5.1 Bold mark mdast ↔ ProseMirror
import type { Mark } from "@tiptap/pm/model";
import type { Schema } from "@tiptap/pm/model";
import type { Node as MdastNode, PhrasingContent, Strong } from "mdast";

export const boldTransformer: MarkTransformerEntry = {
  mdastType: "strong",
  pmMarkType: "bold",

  mdastToMark(_node: MdastNode, schema: Schema) {
    return schema.marks.bold.create();
  },

  markToMdast(_mark: Mark, children: MdastNode[]): MdastNode {
    return {
      type: "strong",
      children: children as PhrasingContent[],
    } as Strong;
  },
};
