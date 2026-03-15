import type { NodeTransformerEntry } from "../types";
// footnote-definition-transformer.ts — §footnote footnoteDefinition ↔ footnoteDefinition
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type {
  BlockContent,
  DefinitionContent,
  FootnoteDefinition,
  Node as MdastNode,
  Parent as MdastParent,
} from "mdast";

export const footnoteDefinitionTransformer: NodeTransformerEntry = {
  mdastType: "footnoteDefinition",
  pmType: "footnoteDefinition",

  mdastToPm(
    node: MdastNode,
    schema: Schema,
    convertChildren: (parent: MdastParent) => PmNode[],
  ) {
    const fnDef = node as FootnoteDefinition;
    const children = convertChildren(fnDef);
    return schema.nodes.footnoteDefinition.create(
      { identifier: fnDef.identifier },
      children.length > 0 ? children : [schema.nodes.paragraph.create()],
    );
  },

  pmToMdast(node: PmNode, convertChildren: (node: PmNode) => MdastNode[]) {
    return {
      type: "footnoteDefinition",
      identifier: node.attrs.identifier as string,
      label: node.attrs.identifier as string,
      children: convertChildren(node) as (BlockContent | DefinitionContent)[],
    } satisfies FootnoteDefinition as MdastNode;
  },
};
