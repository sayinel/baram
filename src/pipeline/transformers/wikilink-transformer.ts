// wikilink-transformer.ts — §28 Wikilink mdast ↔ ProseMirror
// Stub — to be implemented in Step 3

import type { NodeTransformerEntry } from "../types";
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode, Parent as MdastParent } from "mdast";

/** Regex to detect [[...]] patterns in text */
export const WIKILINK_RE =
  /\[\[([^\]|#^]+)(?:#([^\]|^]+))?(?:\^([^\]|]+))?(?:\|([^\]]+))?\]\]/g;

/** Parse wikilink attributes from a regex match */
export function parseWikilinkMatch(match: RegExpMatchArray): {
  blockId: null | string;
  display: null | string;
  heading: null | string;
  target: string;
} {
  return {
    target: match[1],
    heading: match[2] || null,
    blockId: match[3] || null,
    display: match[4] || null,
  };
}

/** Serialize wikilink attrs back to [[...]] string */
export function serializeWikilink(attrs: {
  blockId?: null | string;
  display?: null | string;
  heading?: null | string;
  target: string;
}): string {
  let result = attrs.target;
  if (attrs.heading) result += `#${attrs.heading}`;
  if (attrs.blockId) result += `^${attrs.blockId}`;
  if (attrs.display) result += `|${attrs.display}`;
  return `[[${result}]]`;
}

export const wikilinkTransformer: NodeTransformerEntry = {
  mdastType: "wikiLink", // custom mdast type (won't appear from remark-parse)
  pmType: "wikilink",

  mdastToPm(
    _node: MdastNode,
    _schema: Schema,
    _convertChildren: (parent: MdastParent) => PmNode[],
  ): null | PmNode {
    // Not used — wikilinks are parsed from text nodes in md-to-pm.ts
    return null;
  },

  pmToMdast(
    _node: PmNode,
    _convertChildren: (node: PmNode) => MdastNode[],
  ): MdastNode | null {
    // Not used — wikilinks are serialized in pm-to-md.ts inline handler
    return null;
  },
};
