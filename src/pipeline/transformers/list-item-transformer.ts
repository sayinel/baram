// list-item-transformer.ts — §5.1 List Item mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode, ListItem } from "mdast";
import type { NodeTransformerEntry } from "../types";

export const listItemTransformer: NodeTransformerEntry = {
  mdastType: "listItem",
  pmType: "listItem",

  mdastToPm(node: MdastNode, schema: Schema, convertChildren) {
    const item = node as ListItem;
    // Skip task items (handled by task-list-transformer)
    if (item.checked != null) return null;
    const children = convertChildren(item);
    return schema.nodes.listItem.create(null, children);
  },

  pmToMdast(node: PmNode, convertChildren): MdastNode {
    return {
      type: "listItem",
      spread: false,
      children: convertChildren(node),
    } as ListItem;
  },
};
