// subscript-transformer.ts — §5.1 Subscript mark mdast ↔ ProseMirror
import type { Mark } from "@tiptap/pm/model";
import type { Node as MdastNode, PhrasingContent } from "mdast";
import type { MarkTransformerEntry } from "../types";
import type { Schema } from "@tiptap/pm/model";

export const subscriptTransformer: MarkTransformerEntry = {
  mdastType: "subscript",
  pmMarkType: "subscript",

  mdastToMark(_node: MdastNode, schema: Schema) {
    return schema.marks.subscript.create();
  },

  markToMdast(_mark: Mark, children: MdastNode[]): MdastNode {
    return {
      type: "subscript",
      children: children as PhrasingContent[],
    } as unknown as MdastNode;
  },
};
