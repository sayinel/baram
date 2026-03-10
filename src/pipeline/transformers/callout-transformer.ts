import type { NodeTransformerEntry } from "../types";
// callout-transformer.ts — §5.9 Callout mdast ↔ ProseMirror
// Callout in markdown: > [!type] title / > body
// remark-parse produces mdast "blockquote" — detection is in md-to-pm.ts.
// This transformer handles PM callout → mdast blockquote (reverse direction)
// and provides a helper for md-to-pm detection.
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type {
  Blockquote,
  Node as MdastNode,
  Paragraph,
  PhrasingContent,
  Text,
} from "mdast";

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
    const type = (node.attrs.type as string) || "info";
    const title = (node.attrs.title as string) || "";
    const collapsed = node.attrs.collapsed as boolean;

    // Build header text: [!type] title or [!type]- title
    let header = `[!${type}]`;
    if (collapsed) header += "-";
    if (title) header += ` ${title}`;

    // Title paragraph — uses custom "calloutTitle" node to prevent
    // remark-stringify from escaping [ in [!type].
    const titlePara: Paragraph = {
      type: "paragraph",
      children: [{ type: "calloutTitle", value: header } as unknown as Text],
    };

    // Body children
    const bodyChildren = convertChildren(node);

    return {
      type: "blockquote",
      children: [titlePara, ...bodyChildren],
    } as Blockquote;
  },
};
