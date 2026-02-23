// highlight-transformer.ts — §5.1 Highlight mark mdast ↔ ProseMirror
import type { Mark } from "@tiptap/pm/model";
import type { Node as MdastNode, PhrasingContent } from "mdast";
import type { MarkTransformerEntry } from "../types";
import type { Schema } from "@tiptap/pm/model";

export const highlightTransformer: MarkTransformerEntry = {
  mdastType: "highlight",
  pmMarkType: "highlight",

  mdastToMark(_node: MdastNode, schema: Schema) {
    return schema.marks.highlight.create();
  },

  markToMdast(_mark: Mark, children: MdastNode[]): MdastNode {
    return {
      type: "highlight",
      children: children as PhrasingContent[],
    } as unknown as MdastNode;
  },
};
