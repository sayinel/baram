// superscript-transformer.ts — §5.1 Superscript mark mdast ↔ ProseMirror
import type { Mark } from "@tiptap/pm/model";
import type { Node as MdastNode, PhrasingContent } from "mdast";
import type { MarkTransformerEntry } from "../types";
import type { Schema } from "@tiptap/pm/model";

export const superscriptTransformer: MarkTransformerEntry = {
  mdastType: "superscript",
  pmMarkType: "superscript",

  mdastToMark(_node: MdastNode, schema: Schema) {
    return schema.marks.superscript.create();
  },

  markToMdast(_mark: Mark, children: MdastNode[]): MdastNode {
    return {
      type: "superscript",
      children: children as PhrasingContent[],
    } as unknown as MdastNode;
  },
};
