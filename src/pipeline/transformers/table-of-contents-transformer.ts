import type { NodeTransformerEntry } from "../types";
// table-of-contents-transformer.ts — [TOC] mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Html, Node as MdastNode } from "mdast";

export const tableOfContentsTransformer: NodeTransformerEntry = {
  mdastType: "tableOfContents",
  pmType: "tableOfContents",

  mdastToPm(_node: MdastNode, schema: Schema) {
    return schema.nodes.tableOfContents.create();
  },

  pmToMdast(_node: PmNode): MdastNode {
    return { type: "html", value: "[TOC]" } satisfies Html as MdastNode;
  },
};
