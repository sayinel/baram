import type { NodeTransformerEntry } from "../types";
// §30b Block Reference transformer — stub
// Actual conversion is handled directly in md-to-pm.ts (text splitting) and pm-to-md.ts (inline handler)
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode, Parent as MdastParent } from "mdast";

export const blockReferenceTransformer: NodeTransformerEntry = {
  mdastType: "blockReference",
  pmType: "blockReference",

  mdastToPm(
    _node: MdastNode,
    _schema: Schema,
    _convertChildren: (parent: MdastParent) => PmNode[],
  ): null | PmNode {
    return null;
  },

  pmToMdast(
    _node: PmNode,
    _convertChildren: (node: PmNode) => MdastNode[],
  ): MdastNode | null {
    return null;
  },
};
