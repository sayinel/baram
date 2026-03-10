import type { NodeTransformerEntry } from "../types";
// blockquote-transformer.ts — §5.1 Blockquote mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Blockquote, Node as MdastNode } from "mdast";

export const blockquoteTransformer: NodeTransformerEntry = {
  mdastType: "blockquote",
  pmType: "blockquote",

  mdastToPm(node: MdastNode, schema: Schema, convertChildren) {
    const bq = node as Blockquote;
    const children = convertChildren(bq);
    return schema.nodes.blockquote.create(null, children);
  },

  pmToMdast(node: PmNode, convertChildren): MdastNode {
    return {
      type: "blockquote",
      children: convertChildren(node),
    } as Blockquote;
  },
};
