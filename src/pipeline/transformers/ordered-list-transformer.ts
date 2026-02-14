// ordered-list-transformer.ts — §5.1 Ordered List mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode, List } from "mdast";
import type { NodeTransformerEntry } from "../types";

export const orderedListTransformer: NodeTransformerEntry = {
  mdastType: "list",
  pmType: "orderedList",

  mdastToPm(node: MdastNode, schema: Schema, convertChildren) {
    const list = node as List;
    // Only handle ordered lists
    if (!list.ordered) return null;
    const children = convertChildren(list);
    return schema.nodes.orderedList.create(
      { start: list.start ?? 1 },
      children,
    );
  },

  pmToMdast(node: PmNode, convertChildren): MdastNode {
    return {
      type: "list",
      ordered: true,
      start: (node.attrs.start as number) ?? 1,
      spread: false,
      children: convertChildren(node),
    } as List;
  },
};
