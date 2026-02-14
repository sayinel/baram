// math-block-transformer.ts — §5.3 Block Math mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode } from "mdast";
import type { NodeTransformerEntry } from "../types";

interface MdastMath extends MdastNode {
  type: "math";
  value: string;
  meta?: string | null;
}

export const mathBlockTransformer: NodeTransformerEntry = {
  mdastType: "math",
  pmType: "mathBlock",

  mdastToPm(node: MdastNode, schema: Schema) {
    const math = node as MdastMath;
    return schema.nodes.mathBlock.create(
      { formula: math.value || "" },
      math.value ? [schema.text(math.value)] : [],
    );
  },

  pmToMdast(node: PmNode): MdastNode {
    return {
      type: "math",
      value: node.textContent || (node.attrs.formula as string) || "",
    } as MdastMath;
  },
};
