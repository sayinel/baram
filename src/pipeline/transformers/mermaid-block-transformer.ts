import type { NodeTransformerEntry } from "../types";
// mermaid-block-transformer.ts — §5.5 Mermaid Block mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Code, Node as MdastNode } from "mdast";

export const mermaidBlockTransformer: NodeTransformerEntry = {
  // Uses a synthetic mdast type for Map registration; actual routing is in md-to-pm.ts
  mdastType: "mermaid",
  pmType: "mermaidBlock",

  mdastToPm(node: MdastNode, schema: Schema) {
    const code = node as Code;
    // atom:true — mermaid source stored in attrs only
    return schema.nodes.mermaidBlock.create({ code: code.value || "" });
  },

  pmToMdast(node: PmNode): MdastNode {
    return {
      type: "code",
      lang: "mermaid",
      value: (node.attrs.code as string) || "",
    } as Code;
  },
};
