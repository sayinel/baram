// heading-transformer.ts — §5.1 Heading (H1-H6) mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode, Heading } from "mdast";
import type { NodeTransformerEntry } from "../types";

export const headingTransformer: NodeTransformerEntry = {
  mdastType: "heading",
  pmType: "heading",

  mdastToPm(node: MdastNode, schema: Schema, convertChildren) {
    const heading = node as Heading;
    const children = convertChildren(heading);
    return schema.nodes.heading.create({ level: heading.depth }, children);
  },

  pmToMdast(node: PmNode, convertChildren): MdastNode {
    return {
      type: "heading",
      depth: (node.attrs.level as 1 | 2 | 3 | 4 | 5 | 6) || 1,
      children: convertChildren(node),
    } as Heading;
  },
};
