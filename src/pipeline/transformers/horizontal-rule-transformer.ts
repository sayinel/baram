// horizontal-rule-transformer.ts — §5.1 Horizontal Rule mdast ↔ ProseMirror
import type { Schema } from "@tiptap/pm/model";
import type { Node as MdastNode, ThematicBreak } from "mdast";
import type { NodeTransformerEntry } from "../types";

export const horizontalRuleTransformer: NodeTransformerEntry = {
  mdastType: "thematicBreak",
  pmType: "horizontalRule",

  mdastToPm(_node: MdastNode, schema: Schema) {
    return schema.nodes.horizontalRule.create();
  },

  pmToMdast(): MdastNode {
    return {
      type: "thematicBreak",
    } as ThematicBreak;
  },
};
