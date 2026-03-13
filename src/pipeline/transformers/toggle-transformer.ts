import type { NodeTransformerEntry } from "../types";
// toggle-transformer.ts — §5.1 Toggle (Details/Summary) mdast ↔ ProseMirror
// HTML <details><summary>Title</summary> body </details>
// remark-parse produces sequence: html(<details>...) + block* + html(</details>)
// Pattern detection is in md-to-pm.ts; this file provides parsing helpers.
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode } from "mdast";

/** Check if an HTML value is a </details> closing tag */
export function isDetailsClosing(htmlValue: string): boolean {
  return htmlValue.trim().toLowerCase() === "</details>";
}

/** Check if an HTML value starts a <details> block */
export function isDetailsOpening(htmlValue: string): boolean {
  return /^<details[\s>]/i.test(htmlValue.trim());
}

/**
 * Parse a <details...> opening HTML value.
 * Returns null if not a valid <details> opening.
 */
export function parseDetailsOpening(
  htmlValue: string,
): null | { isOpen: boolean; summary: string } {
  const trimmed = htmlValue.trim();
  if (!/^<details[\s>]/i.test(trimmed)) return null;

  // Check for "open" attribute in the <details> tag
  const detailsTag = trimmed.match(/^<details([^>]*)>/i);
  const isOpen = detailsTag ? /\bopen\b/i.test(detailsTag[1]) : false;

  // Extract <summary>...</summary> content
  const summaryMatch = trimmed.match(/<summary>([\s\S]*?)<\/summary>/i);
  const summary = summaryMatch ? summaryMatch[1].trim() : "";

  return { isOpen, summary };
}

export const toggleTransformer: NodeTransformerEntry = {
  // Virtual mdast type — remark never produces "toggle",
  // detection happens via html node sequence in md-to-pm.ts
  mdastType: "toggle",
  pmType: "toggle",

  mdastToPm(_node: MdastNode, schema: Schema) {
    // Not called directly — toggle conversion is handled in md-to-pm.ts
    return schema.nodes.toggle?.create({ open: true }) ?? null;
  },

  pmToMdast(_node: PmNode) {
    // Not called directly — toggle serialization is handled in pm-to-md.ts
    return { type: "html", value: "" } as unknown as MdastNode;
  },
};
