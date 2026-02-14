// paragraph-transformer.ts — §5.1 Paragraph mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode, Paragraph } from "mdast";
import type { NodeTransformerEntry } from "../types";

export const paragraphTransformer: NodeTransformerEntry = {
  mdastType: "paragraph",
  pmType: "paragraph",

  mdastToPm(node: MdastNode, schema: Schema, convertChildren) {
    const para = node as Paragraph;
    const children = convertChildren(para);
    return schema.nodes.paragraph.create(null, children);
  },

  pmToMdast(node: PmNode, convertChildren): MdastNode {
    return {
      type: "paragraph",
      children: convertChildren(node),
    } as Paragraph;
  },
};
