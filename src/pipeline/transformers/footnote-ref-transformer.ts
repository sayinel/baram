import type { NodeTransformerEntry } from "../types";
// footnote-ref-transformer.ts — §footnote footnoteReference ↔ footnoteRef
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode } from "mdast";

export const footnoteRefTransformer: NodeTransformerEntry = {
  mdastType: "footnoteReference",
  pmType: "footnoteRef",

  mdastToPm(node: MdastNode, schema: Schema) {
    const fnRef = node as MdastNode & { identifier: string };
    return schema.nodes.footnoteRef.create({
      identifier: fnRef.identifier,
    });
  },

  pmToMdast(node: PmNode) {
    return {
      type: "footnoteReference",
      identifier: node.attrs.identifier as string,
      label: node.attrs.identifier as string,
    } as unknown as MdastNode;
  },
};
