// math-inline-transformer.ts — §5.3 Inline Math mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode } from "mdast";
import type { NodeTransformerEntry } from "../types";

interface MdastInlineMath extends MdastNode {
  type: "inlineMath";
  value: string;
}

export const mathInlineTransformer: NodeTransformerEntry = {
  mdastType: "inlineMath",
  pmType: "mathInline",

  mdastToPm(node: MdastNode, schema: Schema) {
    const math = node as MdastInlineMath;
    return schema.nodes.mathInline.create({ formula: math.value || "" });
  },

  pmToMdast(node: PmNode): MdastNode {
    return {
      type: "inlineMath",
      value: (node.attrs.formula as string) || "",
    } as MdastInlineMath;
  },
};
