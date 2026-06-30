import type { NodeTransformerEntry } from "../types";
// svg-block-transformer.ts — §5.1 SVG Block mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Code, Node as MdastNode } from "mdast";

export const svgBlockTransformer: NodeTransformerEntry = {
  // Synthetic mdast type for Map registration; actual md→PM routing happens in
  // md-to-pm.ts via CODE_LANG_MAP (```svg fenced code → svgBlock).
  mdastType: "svg",
  pmType: "svgBlock",

  mdastToPm(node: MdastNode, schema: Schema) {
    const code = node as Code;
    // atom:true — raw SVG source stored in attrs only.
    return schema.nodes.svgBlock.create({ code: code.value || "" });
  },

  pmToMdast(node: PmNode): MdastNode {
    return {
      type: "code",
      lang: "svg",
      value: (node.attrs.code as string) || "",
    } as Code;
  },
};
