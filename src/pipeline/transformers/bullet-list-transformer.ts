import type { NodeTransformerEntry } from "../types";
// bullet-list-transformer.ts — §5.1 Unordered List mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { List, Node as MdastNode } from "mdast";

export const bulletListTransformer: NodeTransformerEntry = {
  mdastType: "list",
  pmType: "bulletList",

  mdastToPm(node: MdastNode, schema: Schema, convertChildren) {
    const list = node as List;
    // Only handle unordered lists (ordered handled by ordered-list-transformer)
    if (list.ordered) return null;
    const children = convertChildren(list);
    return schema.nodes.bulletList.create(null, children);
  },

  pmToMdast(node: PmNode, convertChildren): MdastNode {
    return {
      type: "list",
      ordered: false,
      spread: false,
      children: convertChildren(node),
    } as List;
  },
};
