// convert-block-special.ts — Special block-level conversions (toggle, definition list, block ID extraction)
// Extracted from md-to-pm.ts for single-responsibility

import type { Mark, Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Content, PhrasingContent, Text } from "mdast";

import { extractBlockId } from "./block-id";
import {
  DEFINITION_PREFIX_RE,
  isDefinitionLine,
  stripDefinitionPrefix,
} from "./transformers/definition-list-transformer";
import {
  isDetailsClosing,
  isDetailsOpening,
  parseDetailsOpening,
} from "./transformers/toggle-transformer";

/** Callback type for recursive block conversion */
export type ConvertBlockFn = (children: Content[], schema: Schema) => PmNode[];

/** Callback type for inline children conversion */
export type ConvertInlineFn = (
  children: PhrasingContent[],
  schema: Schema,
  parentMarks: Mark[],
) => PmNode[];

interface BlockIdResult {
  blockId: string;
  strippedChildren: Content[];
}

/**
 * §30a: Extract block ID from the last text child of an mdast node.
 * Returns a new children array with the block ID suffix stripped, without mutating the original.
 * Returns null if no block ID is found.
 */
export function extractBlockIdFromMdast(node: Content): BlockIdResult | null {
  const children = (node as { children?: Content[] }).children;
  if (!children || children.length === 0) return null;

  // Find the last text node (block ID must be at the very end of block content)
  const lastChild = children[children.length - 1];
  if (lastChild.type !== "text") return null;

  const text = (lastChild as Text).value;
  const result = extractBlockId(text);
  if (!result) return null;

  // Return new children array without mutating original
  let strippedChildren: Content[];
  if (result.strippedText) {
    strippedChildren = [
      ...children.slice(0, -1),
      { ...lastChild, value: result.strippedText } as Content,
    ];
  } else {
    // If stripping leaves empty text, omit the last child entirely
    strippedChildren = children.slice(0, -1);
  }

  return { blockId: result.blockId, strippedChildren };
}

/** Check if a paragraph starts with `: ` (definition line) */
export function isDefinitionParagraph(para: {
  children: PhrasingContent[];
}): boolean {
  if (para.children.length === 0) return false;
  const first = para.children[0];
  return first.type === "text" && isDefinitionLine((first as Text).value);
}

/**
 * Try to convert a sequence of paragraphs into a definition list.
 *
 * remark-parse does NOT create separate paragraphs for `Term\n: Def` (no blank line).
 * Instead, it produces a SINGLE paragraph with text "Term\n: Def".
 *
 * Two patterns:
 * 1. Single paragraph: text contains `\n: ` — term is text before first `\n: `, defs after.
 * 2. Two paragraphs (blank line): paragraph(term) + paragraph(`: def`).
 *
 * Multiple consecutive definition groups are merged into one <dl>.
 */
export function tryConvertDefinitionList(
  children: Content[],
  startIndex: number,
  schema: Schema,
  convertInlineChildren: ConvertInlineFn,
): null | { endIndex: number; node: PmNode } {
  const dlChildren: PmNode[] = [];
  let i = startIndex;

  while (i < children.length) {
    const child = children[i];
    if (child.type !== "paragraph") break;

    const paraChildren = (child as { children: PhrasingContent[] }).children;

    // Pattern 1: Single paragraph with inline definition (Term\n: Def)
    const inlineResult = tryParseInlineDefinition(
      paraChildren,
      schema,
      convertInlineChildren,
    );
    if (inlineResult) {
      dlChildren.push(...inlineResult);
      i++;
      continue;
    }

    // Pattern 2: Two separate paragraphs — term paragraph + `: def` paragraph
    // Only attempt if this paragraph is NOT a definition line itself
    if (paraChildren.length > 0) {
      const firstText = paraChildren[0];
      if (
        firstText.type === "text" &&
        isDefinitionLine((firstText as Text).value)
      ) {
        break; // Starts with `: ` — not a term
      }
    }

    const nextChild = children[i + 1];
    if (
      nextChild?.type === "paragraph" &&
      isDefinitionParagraph(nextChild as { children: PhrasingContent[] })
    ) {
      // This is a term paragraph
      const termInlineNodes = convertInlineChildren(paraChildren, schema, []);
      dlChildren.push(
        schema.nodes.definitionTerm.create(null, termInlineNodes),
      );

      // Consume consecutive definition paragraphs
      let j = i + 1;
      while (j < children.length) {
        const dc = children[j];
        if (dc.type !== "paragraph") break;
        if (!isDefinitionParagraph(dc as { children: PhrasingContent[] }))
          break;

        const dcChildren = (dc as { children: PhrasingContent[] }).children;
        const strippedChildren = stripDefinitionPrefix(dcChildren);
        const descInlineNodes = convertInlineChildren(
          strippedChildren,
          schema,
          [],
        );
        dlChildren.push(
          schema.nodes.definitionDescription.create(null, descInlineNodes),
        );
        j++;
      }

      i = j;
      continue;
    }

    break; // Not a definition pattern
  }

  if (dlChildren.length === 0) return null;

  const dlNode = schema.nodes.definitionList.create(null, dlChildren);
  return { node: dlNode, endIndex: i - 1 };
}

/**
 * §5.1: Try to convert a sequence of html(<details>...) + block* + html(</details>)
 * into a toggle PM node. Returns null if pattern not matched.
 *
 * `convertBlockChildren` is passed as a callback to break the circular dependency.
 */
export function tryConvertToggle(
  children: Content[],
  startIndex: number,
  schema: Schema,
  convertBlockChildren: ConvertBlockFn,
): null | { endIndex: number; node: PmNode } {
  const openHtml = (children[startIndex] as { value: string }).value;
  const parsed = parseDetailsOpening(openHtml);
  if (!parsed) return null;

  // Find matching </details>, handling nesting
  let depth = 1;
  let endIndex = -1;
  for (let j = startIndex + 1; j < children.length; j++) {
    if (children[j].type === "html") {
      const val = (children[j] as { value: string }).value;
      if (isDetailsOpening(val)) depth++;
      if (isDetailsClosing(val)) {
        depth--;
        if (depth === 0) {
          endIndex = j;
          break;
        }
      }
    }
  }

  if (endIndex === -1) return null; // No matching closing tag

  // Collect body children (between opening and closing html nodes)
  const bodyMdastChildren = children.slice(startIndex + 1, endIndex);

  // Recursively convert body children (handles nested toggles)
  const bodyPmNodes =
    bodyMdastChildren.length > 0
      ? convertBlockChildren(bodyMdastChildren, schema)
      : [];

  // Create summary node (first child of toggle)
  // Detect heading prefix: "## Title" → heading level 2
  const headingMatch = parsed.summary.match(/^(#{1,6})\s+(.*)$/);
  let summaryNode;
  if (headingMatch && schema.nodes.heading) {
    const level = headingMatch[1].length;
    const text = headingMatch[2];
    summaryNode = schema.nodes.heading.create(
      { level },
      text ? [schema.text(text)] : undefined,
    );
  } else {
    summaryNode = parsed.summary
      ? schema.nodes.paragraph.create(null, [schema.text(parsed.summary)])
      : schema.nodes.paragraph.create();
  }

  // Build toggle node: summary (paragraph or heading) + body blocks
  const toggleNode = schema.nodes.toggle.create({ open: parsed.isOpen }, [
    summaryNode,
    ...bodyPmNodes,
  ]);

  return { node: toggleNode, endIndex };
}

/**
 * Parse a single paragraph that contains term + definitions inline.
 * remark-parse combines `Term\n: Def` into one paragraph with text "Term\n: Def".
 * Returns array of [definitionTerm, definitionDescription, ...] PM nodes, or null.
 */
function tryParseInlineDefinition(
  paraChildren: PhrasingContent[],
  schema: Schema,
  convertInlineChildren: ConvertInlineFn,
): null | PmNode[] {
  // Find the first text node containing `\n` followed by a line starting with `: `
  let splitChildIdx = -1;
  let splitOffset = -1;

  for (let ci = 0; ci < paraChildren.length; ci++) {
    const child = paraChildren[ci];
    if (child.type !== "text") continue;

    const text = (child as Text).value;
    // Search for \n followed by `: `
    let searchFrom = 0;
    while (searchFrom < text.length) {
      const nlIdx = text.indexOf("\n", searchFrom);
      if (nlIdx === -1) break;
      const afterNl = text.substring(nlIdx + 1);
      if (isDefinitionLine(afterNl.split("\n")[0])) {
        splitChildIdx = ci;
        splitOffset = nlIdx;
        break;
      }
      searchFrom = nlIdx + 1;
    }
    if (splitChildIdx !== -1) break;
  }

  if (splitChildIdx === -1) return null;

  // Verify the first line is not a definition line
  const firstChild = paraChildren[0];
  if (firstChild.type === "text") {
    const firstLine = (firstChild as Text).value.split("\n")[0];
    if (isDefinitionLine(firstLine)) return null;
  }

  // Build term children: everything before the split point
  const termPhrasingChildren: PhrasingContent[] = [];
  for (let ci = 0; ci < splitChildIdx; ci++) {
    termPhrasingChildren.push(paraChildren[ci]);
  }
  const splitTextValue = (paraChildren[splitChildIdx] as Text).value;
  const termTextPart = splitTextValue.substring(0, splitOffset);
  if (termTextPart) {
    termPhrasingChildren.push({ type: "text", value: termTextPart } as Text);
  }

  // Create term PM node
  const termInlines = convertInlineChildren(termPhrasingChildren, schema, []);
  const result: PmNode[] = [
    schema.nodes.definitionTerm.create(null, termInlines),
  ];

  // Extract definition lines from the text after the split
  const defText = splitTextValue.substring(splitOffset + 1);
  const defLines = defText.split("\n");

  for (let li = 0; li < defLines.length; li++) {
    const line = defLines[li];
    if (!isDefinitionLine(line)) continue;

    const stripped = line.replace(DEFINITION_PREFIX_RE, "");
    const defPhrasingChildren: PhrasingContent[] = stripped
      ? [{ type: "text", value: stripped } as Text]
      : [];

    // For the last definition line, append any remaining inline children
    // after the split text node (e.g. bold/italic marks following the def text)
    if (li === defLines.length - 1 && splitChildIdx + 1 < paraChildren.length) {
      defPhrasingChildren.push(...paraChildren.slice(splitChildIdx + 1));
    }

    const descInlines = convertInlineChildren(defPhrasingChildren, schema, []);
    result.push(schema.nodes.definitionDescription.create(null, descInlines));
  }

  return result.length > 1 ? result : null;
}
