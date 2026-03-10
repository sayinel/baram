import type { NodeTransformerEntry } from "../types";
// math-block-transformer.ts — §5.3 Block Math mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode } from "mdast";

interface MdastMath extends MdastNode {
  meta?: null | string;
  type: "math";
  value: string;
}

export const mathBlockTransformer: NodeTransformerEntry = {
  mdastType: "math",
  pmType: "mathBlock",

  mdastToPm(node: MdastNode, schema: Schema) {
    const math = node as MdastMath;
    // atom:true — formula stored in attrs only, no text children
    return schema.nodes.mathBlock.create({ formula: math.value || "" });
  },

  pmToMdast(node: PmNode): MdastNode {
    return {
      type: "math",
      value: (node.attrs.formula as string) || "",
    } as MdastMath;
  },
};
