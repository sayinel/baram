// italic-transformer.ts — §5.1 Italic mark mdast ↔ ProseMirror
import type { Mark } from "@tiptap/pm/model";
import type { Node as MdastNode, Emphasis, PhrasingContent } from "mdast";
import type { MarkTransformerEntry } from "../types";
import type { Schema } from "@tiptap/pm/model";

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
