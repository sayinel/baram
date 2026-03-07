// query-block-transformer.ts — §5.13 Query Block mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode, Code } from "mdast";
import type { NodeTransformerEntry } from "../types";

export const queryBlockTransformer: NodeTransformerEntry = {
  // Uses a synthetic mdast type for Map registration; actual routing is in md-to-pm.ts
  mdastType: "query",
  pmType: "queryBlock",

  mdastToPm(node: MdastNode, schema: Schema) {
    const code = node as Code;
    return schema.nodes.queryBlock.create({ query: code.value || "" });
  },

  pmToMdast(node: PmNode): MdastNode {
    return {
      type: "code",
      lang: "query",
      value: (node.attrs.query as string) || "",
    } as Code;
  },
};
