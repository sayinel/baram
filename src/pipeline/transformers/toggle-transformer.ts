import type { NodeTransformerEntry } from "../types";
// toggle-transformer.ts — §5.1 Toggle (Details/Summary) mdast ↔ ProseMirror
// HTML <details><summary>Title</summary> body </details>
// remark-parse produces sequence: html(<details>...) + block* + html(</details>)
// Pattern detection is in md-to-pm.ts; this file provides parsing helpers.
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Content, Html, Node as MdastNode, Root } from "mdast";

import { mdastToMarkdown } from "../serializer";

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

/** Escape HTML special characters for safe insertion into tag content */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
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

  pmToMdast(node: PmNode, convertChildren): MdastNode {
    const isOpen = node.attrs.open as boolean;
    const openTag = isOpen ? "<details open>" : "<details>";

    // First child is summary (paragraph or heading)
    const summaryChild = node.childCount > 0 ? node.child(0) : null;
    let summaryText = "";
    if (summaryChild) {
      if (summaryChild.type.name === "heading") {
        // Heading summary: prefix with # marks
        const level = summaryChild.attrs.level as number;
        const prefix = "#".repeat(level);
        summaryText = summaryChild.textContent
          ? `${prefix} ${summaryChild.textContent}`
          : prefix;
      } else {
        summaryText = summaryChild.textContent;
      }
    }

    // convertChildren converts all block children of the toggle node.
    // Skip the first (summary) to get only body children.
    const allChildren = convertChildren(node) as Content[];
    const bodyChildren = allChildren.slice(1);

    // Serialize body to markdown
    let bodyMd = "";
    if (bodyChildren.length > 0) {
      const bodyMdast: Root = { type: "root", children: bodyChildren };
      bodyMd = mdastToMarkdown(bodyMdast).trimEnd();
    }

    // Build the complete HTML block
    const parts: string[] = [];
    if (summaryText) {
      parts.push(`${openTag}\n<summary>${escapeHtml(summaryText)}</summary>`);
    } else {
      parts.push(openTag);
    }
    if (bodyMd) {
      parts.push(""); // blank line to separate HTML from markdown
      parts.push(bodyMd);
    }
    parts.push(""); // blank line before closing tag
    parts.push("</details>");

    return {
      type: "html",
      value: parts.join("\n"),
    } satisfies Html as MdastNode;
  },
};
