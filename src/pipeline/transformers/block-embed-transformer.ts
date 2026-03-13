import type { NodeTransformerEntry } from "../types";
// §30b Block Embed transformer
// md-to-pm: paragraph detection is handled directly in md-to-pm.ts
// pm-to-md: serialize as paragraph with embed text
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type {
  Node as MdastNode,
  Parent as MdastParent,
  Paragraph,
} from "mdast";

import { serializeBlockEmbed } from "../block-id";

export const blockEmbedTransformer: NodeTransformerEntry = {
  mdastType: "blockEmbed",
  pmType: "blockEmbed",

  mdastToPm(
    _node: MdastNode,
    _schema: Schema,
    _convertChildren: (parent: MdastParent) => PmNode[],
  ): null | PmNode {
    return null;
  },

  pmToMdast(node: PmNode): MdastNode {
    const text = serializeBlockEmbed(
      node.attrs as { blockId: string; target: string },
    );
    return {
      type: "paragraph",
      children: [{ type: "text", value: text }],
    } as Paragraph;
  },
};
