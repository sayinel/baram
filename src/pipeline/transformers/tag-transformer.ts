import type { NodeTransformerEntry } from "../types";
// §56m tag-transformer.ts — Tag mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode, Parent as MdastParent } from "mdast";

/** Regex to detect #tag patterns in text.
 *  Matches #tag at start of string or after whitespace.
 *  Uses alternation instead of lookbehind for broadest compatibility. */
export const TAG_NODE_RE =
  /(?:^|(?<=[\s]))#([\w\uAC00-\uD7A3]+(?:\/[\w\uAC00-\uD7A3]+)*)/g;

/** Serialize tag node back to #tag string */
export function serializeTag(attrs: { tag: string }): string {
  return `#${attrs.tag}`;
}

export const tagTransformer: NodeTransformerEntry = {
  mdastType: "tagNode", // custom mdast type
  pmType: "tagNode",

  mdastToPm(
    _node: MdastNode,
    _schema: Schema,
    _convertChildren: (parent: MdastParent) => PmNode[],
  ): null | PmNode {
    // Not used — tags are parsed from text nodes in md-to-pm.ts
    return null;
  },

  pmToMdast(
    _node: PmNode,
    _convertChildren: (node: PmNode) => MdastNode[],
  ): MdastNode | null {
    // Not used — tags are serialized in pm-to-md.ts inline handler
    return null;
  },
};
