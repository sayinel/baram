import type { NodeTransformerEntry } from "../types";
// §56m tag-transformer.ts — Tag mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode, Parent as MdastParent } from "mdast";

import { TAG_BODY } from "../../utils/tags/tag-lexicon";

/** Regex to detect #tag patterns in text.
 *  Matches #tag at start of string or after whitespace.
 *  Uses positive lookbehind (?<=[\s]) for whitespace boundary detection.
 *  글자 어휘는 `tag-lexicon.ts`가 갖는다 — 에디터 입력 규칙과 같은 출처여야
 *  친 것과 연 것이 같은 태그가 된다. */
export const TAG_NODE_RE = new RegExp(`(?:^|(?<=[\\s]))#(${TAG_BODY})`, "g");

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
