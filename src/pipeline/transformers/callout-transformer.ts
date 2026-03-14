import type { NodeTransformerEntry } from "../types";
// callout-transformer.ts — §5.9 Callout mdast ↔ ProseMirror
// Callout in markdown: > [!type] title / > body
// remark-parse produces mdast "blockquote" — detection is in md-to-pm.ts.
// This transformer handles PM callout → mdast (reverse direction)
// and provides a helper for md-to-pm detection.
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type {
  Blockquote,
  Content,
  Html,
  Node as MdastNode,
  Paragraph,
  PhrasingContent,
  Root,
  Text,
} from "mdast";

import { mdastToMarkdown } from "../serializer";

/** Regex to detect callout syntax in the first line of a blockquote paragraph.
 *  Matches: [!type], [!type]-, [!type]+, [!type] title, [!type]- title
 */
export const CALLOUT_RE = /^\[!(\w+)\]([+-])?\s*(.*)?$/;

/** Parse a single line for callout header syntax.
 *  Returns null if not a callout.
 */
export function parseCalloutHeader(
  line: string,
): null | { collapsed: boolean; title: string; type: string } {
  const m = line.match(CALLOUT_RE);
  if (!m) return null;
  const type = m[1].toLowerCase();
  const collapseFlag = m[2] || "";
  const title = (m[3] || "").trim();
  return {
    type,
    title,
    collapsed: collapseFlag === "-",
  };
}

export const calloutTransformer: NodeTransformerEntry = {
  // mdastType is "callout" (virtual — remark produces "blockquote", detection
  // happens in md-to-pm.ts before the standard transformer lookup)
  mdastType: "callout",
  pmType: "callout",

  mdastToPm(node: MdastNode, schema: Schema, convertChildren) {
    // This is called from md-to-pm.ts after detecting callout pattern.
    // The node passed here is the original blockquote mdast node.
    const bq = node as Blockquote;

    // Extract callout header from first child paragraph
    const firstChild = bq.children[0];
    if (!firstChild || firstChild.type !== "paragraph") {
      return schema.nodes.callout.create(null, convertChildren(bq));
    }

    const firstPara = firstChild as Paragraph;
    const firstTextNode = firstPara.children[0];
    const firstText =
      firstTextNode?.type === "text" ? (firstTextNode as Text).value : "";

    // Parse only the first line for callout header
    const firstLine = firstText.split("\n")[0];
    const parsed = parseCalloutHeader(firstLine);

    const attrs = {
      type: parsed?.type || "info",
      title: parsed?.title || "",
      collapsed: parsed?.collapsed || false,
    };

    // remark-parse joins consecutive > lines into one paragraph.
    // The first paragraph may contain both title line and body text.
    // We need to split: first line → title (consumed), rest → body paragraph.
    const remainingText = firstText.split("\n").slice(1).join("\n");
    const remainingInlineChildren = firstPara.children.slice(1);

    // Build body children from:
    // 1. Remaining text from the first paragraph (if any)
    // 2. All subsequent blockquote children
    const extraBodyChildren: Blockquote["children"] = [];

    if (remainingText || remainingInlineChildren.length > 0) {
      // Create a new paragraph from the remaining content
      const newParaChildren: PhrasingContent[] = [];
      if (remainingText) {
        newParaChildren.push({ type: "text", value: remainingText } as Text);
      }
      newParaChildren.push(...(remainingInlineChildren as PhrasingContent[]));
      extraBodyChildren.push({
        type: "paragraph",
        children: newParaChildren,
      } as Paragraph);
    }

    const allBodyChildren = [...extraBodyChildren, ...bq.children.slice(1)];

    const bodyBq: Blockquote = {
      type: "blockquote",
      children: allBodyChildren,
    };

    const pmChildren =
      allBodyChildren.length > 0 ? convertChildren(bodyBq) : [];

    // If no body content, create at least one empty paragraph
    if (pmChildren.length === 0) {
      pmChildren.push(schema.nodes.paragraph.create());
    }

    return schema.nodes.callout.create(attrs, pmChildren);
  },

  pmToMdast(node: PmNode, convertChildren): MdastNode {
    const cType = (node.attrs.type as string) || "info";
    const cTitle = (node.attrs.title as string) || "";
    const cCollapsed = node.attrs.collapsed as boolean;

    let header = `[!${cType}]`;
    if (cCollapsed) header += "-";
    if (cTitle) header += ` ${cTitle}`;

    // Serialize body to markdown via the normal pipeline
    const bodyMdast: Root = {
      type: "root",
      children: convertChildren(node) as Content[],
    };
    const bodyMd = mdastToMarkdown(bodyMdast).trimEnd();

    // Build blockquote lines manually to preserve [!type] without escaping
    const lines = [`> ${header}`];
    for (const line of bodyMd.split("\n")) {
      lines.push(line ? `> ${line}` : ">");
    }

    // Return as html flow node (remark-stringify passes through verbatim)
    return { type: "html", value: lines.join("\n") } as Html;
  },
};
