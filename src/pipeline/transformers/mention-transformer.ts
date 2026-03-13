// mention-transformer.ts — §57 Mention mdast ↔ ProseMirror
// @[[value]] syntax — date mentions (YYYY-MM-DD) or page mentions

import type { NodeTransformerEntry } from "../types";
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode, Parent as MdastParent } from "mdast";

/** Regex to detect @[[...]] mention patterns in text */
export const MENTION_RE = /@\[\[([^\]]+)\]\]/g;

/** Parse mention attributes from a regex match */
export function parseMentionMatch(match: RegExpMatchArray): {
  type: "date" | "page";
  value: string;
} {
  const value = match[1];
  return {
    type: isDateValue(value) ? "date" : "page",
    value,
  };
}

/** Serialize mention attrs back to @[[value]] string */
export function serializeMention(attrs: {
  type: string;
  value: string;
}): string {
  return `@[[${attrs.value}]]`;
}

/** Detect if a value is a date (YYYY-MM-DD) */
function isDateValue(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export const mentionTransformer: NodeTransformerEntry = {
  mdastType: "mention", // custom mdast type (won't appear from remark-parse)
  pmType: "mention",

  mdastToPm(
    _node: MdastNode,
    _schema: Schema,
    _convertChildren: (parent: MdastParent) => PmNode[],
  ): null | PmNode {
    // Not used — mentions are parsed from text nodes in md-to-pm.ts
    return null;
  },

  pmToMdast(
    _node: PmNode,
    _convertChildren: (node: PmNode) => MdastNode[],
  ): MdastNode | null {
    // Not used — mentions are serialized in pm-to-md.ts inline handler
    return null;
  },
};
