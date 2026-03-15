import type { NodeTransformerEntry } from "../types";
// html-block-transformer.ts — §5.1 HTML Block mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Html, Node as MdastNode } from "mdast";

export const htmlBlockTransformer: NodeTransformerEntry = {
  // Note: mdastType "html" conflicts with inline html handling.
  // This transformer is NOT registered in the standard map — it's used
  // as a fallback in md-to-pm.ts convertBlockChildren directly.
  // pmToMdast is used via the pmNodeTransformers reverse-lookup map.
  mdastType: "htmlBlock",
  pmType: "htmlBlock",

  mdastToPm(node: MdastNode, schema: Schema): PmNode {
    const html = (node as Html).value;
    return schema.nodes.htmlBlock.create({ content: html });
  },

  pmToMdast(node: PmNode): MdastNode {
    return {
      type: "html",
      value: node.attrs.content as string,
    } satisfies Html as MdastNode;
  },
};
