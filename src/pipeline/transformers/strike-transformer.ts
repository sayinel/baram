import type { MarkTransformerEntry } from "../types";
// strike-transformer.ts — §5.1 Strikethrough mark mdast ↔ ProseMirror
import type { Mark } from "@tiptap/pm/model";
import type { Schema } from "@tiptap/pm/model";
import type { Node as MdastNode, PhrasingContent } from "mdast";

interface Delete extends MdastNode {
  children: PhrasingContent[];
  type: "delete";
}

export const strikeTransformer: MarkTransformerEntry = {
  mdastType: "delete",
  pmMarkType: "strike",

  mdastToMark(_node: MdastNode, schema: Schema) {
    return schema.marks.strike.create();
  },

  markToMdast(_mark: Mark, children: MdastNode[]): MdastNode {
    return {
      type: "delete",
      children: children as PhrasingContent[],
    } as Delete;
  },
};
