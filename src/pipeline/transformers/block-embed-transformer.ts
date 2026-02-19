// §30b Block Embed transformer — stub
// Actual conversion is handled directly in md-to-pm.ts (paragraph detection) and pm-to-md.ts
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode, Parent as MdastParent } from "mdast";
import type { NodeTransformerEntry } from "../types";

export const blockEmbedTransformer: NodeTransformerEntry = {
  mdastType: "blockEmbed",
  pmType: "blockEmbed",

  mdastToPm(
    _node: MdastNode,
    _schema: Schema,
    _convertChildren: (parent: MdastParent) => PmNode[],
  ): PmNode | null {
    return null;
  },

  pmToMdast(
    _node: PmNode,
    _convertChildren: (node: PmNode) => MdastNode[],
  ): MdastNode | null {
    return null;
  },
};
