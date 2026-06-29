// md-to-pm.ts — §3.3 Markdown → ProseMirror Document 변환 파이프라인
//
// Public API + orchestrator. Implementation details are split into:
//   convert-inline-text.ts  — text splitting for inline patterns
//   convert-list.ts         — list node conversion
//   convert-block-special.ts — toggle, definition list, block ID extraction
//
import type { Mark, Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Content, PhrasingContent, Root, Text } from "mdast";

import { BLOCK_EMBED_RE, parseBlockEmbedMatch } from "./block-id";
import {
  extractBlockIdFromMdast,
  isDefinitionParagraph,
  tryConvertDefinitionList,
  tryConvertToggle,
} from "./convert-block-special";
import {
  splitTextWithBlockRefs,
  splitTextWithCustomInlineMarks,
  splitTextWithMentions,
  splitTextWithTags,
  splitTextWithWikilinks,
} from "./convert-inline-text";
import { convertListNode } from "./convert-list";
import { parseMdastAsync } from "./parse-async";
import { enrichWithEmptyParagraphs, parseMdast } from "./parse-mdast";
import {
  markTransformers,
  nodeTransformers,
  pmNodeTransformers,
} from "./transformers";
import { parseCalloutHeader } from "./transformers/callout-transformer";
import {
  isStandaloneImage,
  parseImgHtml,
} from "./transformers/image-transformer";
import { isDetailsOpening } from "./transformers/toggle-transformer";

// §5.5 Mermaid / §5.13 Query: code block lang → dedicated block node mapping
// Moved to module scope to avoid per-call allocation inside convertBlockNode
const CODE_LANG_MAP = [
  { lang: "mermaid", schemaNode: "mermaidBlock", transformerKey: "mermaid" },
  { lang: "query", schemaNode: "queryBlock", transformerKey: "query" },
] as const;

// §perf-large-file: Set for O(1) inline type check (replaces per-call array allocation)
const INLINE_TYPES = new Set([
  "break",
  "delete",
  "emphasis",
  "html",
  "image",
  "inlineCode",
  "inlineMath",
  "link",
  "strong",
  "text",
]);

// parseMdast + enrichWithEmptyParagraphs are imported from ./parse-mdast
// (pure module with no ProseMirror deps — safe for Web Worker import)
export { parseMdast };

/** Full pipeline: markdown string → ProseMirror document */
export function markdownToProsemirror(
  markdown: string,
  schema: Schema,
): PmNode {
  const mdast = parseMdast(markdown);
  const enriched = enrichWithEmptyParagraphs(mdast, markdown);
  return mdastToProsemirror(enriched, schema);
}

/** §perf-large-file B1: Async pipeline — parse in Web Worker, convert on main thread. */
export async function markdownToProsemirrorAsync(
  markdown: string,
  schema: Schema,
): Promise<PmNode> {
  const enriched = await parseMdastAsync(markdown);
  return mdastToProsemirror(enriched, schema);
}

/** §perf-large-file C2: Convert mdast blocks to PM node array (for progressive loading). */
export function mdastBlocksToPmNodes(root: Root, schema: Schema): PmNode[] {
  const nodes = convertBlockChildren(root.children, schema);
  if (nodes.length === 0) {
    nodes.push(schema.nodes.paragraph.create());
  }
  return nodes;
}

/** Convert mdast tree to ProseMirror document */
export function mdastToProsemirror(root: Root, schema: Schema): PmNode {
  const children = convertBlockChildren(root.children, schema);
  // Ensure at least one block node (doc content spec is "block+")
  if (children.length === 0) {
    children.push(schema.nodes.paragraph.create());
  }
  return schema.nodes.doc.create(null, children);
}

/** Regex for colwidths HTML comment: `<!-- colwidths:200,300,150 -->` */
const COLWIDTHS_RE = /^<!--\s*colwidths:([\d,]+)\s*-->$/;

/** Apply pending colwidths to a table PM node by setting colwidth + userResized on cells */
function applyColwidthsToTable(tableNode: PmNode, colwidths: number[]): PmNode {
  const rows: PmNode[] = [];
  tableNode.forEach((row) => {
    const cells: PmNode[] = [];
    let colIdx = 0;
    row.forEach((cell) => {
      const colspan = (cell.attrs.colspan as number) || 1;
      const colwidthArr = colwidths.slice(colIdx, colIdx + colspan);
      colIdx += colspan;
      // Only apply if the sliced array has valid widths matching colspan
      if (colwidthArr.length === colspan && colwidthArr.every((w) => w > 0)) {
        cells.push(
          cell.type.create(
            { ...cell.attrs, colwidth: colwidthArr, userResized: true },
            cell.content,
            cell.marks,
          ),
        );
      } else {
        cells.push(cell);
      }
    });
    rows.push(row.type.create(row.attrs, cells, row.marks));
  });
  return tableNode.type.create(tableNode.attrs, rows, tableNode.marks);
}

/** Convert block-level mdast children to PM nodes */
function convertBlockChildren(children: Content[], schema: Schema): PmNode[] {
  const result: PmNode[] = [];
  let i = 0;
  let pendingColwidths: null | number[] = null;

  while (i < children.length) {
    const child = children[i];

    // §5.5: Detect colwidths HTML comment → store for next table
    if (child.type === "html") {
      const htmlVal = (child as { value: string }).value;
      const colMatch = COLWIDTHS_RE.exec(htmlVal);
      if (colMatch) {
        pendingColwidths = colMatch[1].split(",").map(Number);
        i++;
        continue;
      }
    }

    // §5.1: Detect <details> html pattern → toggle node
    if (child.type === "html" && schema.nodes.toggle) {
      const htmlVal = (child as { value: string }).value;
      if (isDetailsOpening(htmlVal)) {
        const toggleResult = tryConvertToggle(
          children,
          i,
          schema,
          convertBlockChildren,
        );
        if (toggleResult) {
          result.push(toggleResult.node);
          i = toggleResult.endIndex + 1;
          pendingColwidths = null;
          continue;
        }
      }
    }

    // §5.1: Detect <img> html with width → image node with widthPercent
    if (child.type === "html" && schema.nodes.image) {
      const imgAttrs = parseImgHtml((child as { value: string }).value);
      if (imgAttrs) {
        result.push(schema.nodes.image.create(imgAttrs));
        i++;
        pendingColwidths = null;
        continue;
      }
    }

    // Fallback: unrecognized HTML block → htmlBlock node
    if (child.type === "html" && schema.nodes.htmlBlock) {
      const htmlVal = (child as { value: string }).value;
      result.push(schema.nodes.htmlBlock.create({ content: htmlVal }));
      i++;
      pendingColwidths = null;
      continue;
    }

    // Detect definition list: paragraph(non-:) + paragraph(:) pattern
    // §perf-large-file: Pre-check avoids calling tryConvertDefinitionList on 99% of paragraphs
    if (child.type === "paragraph" && schema.nodes.definitionList) {
      const paraChildren = (child as { children: PhrasingContent[] }).children;
      const nextIsDefPara =
        children[i + 1]?.type === "paragraph" &&
        isDefinitionParagraph(
          children[i + 1] as { children: PhrasingContent[] },
        );
      const hasInlineDef = paraChildren.some(
        (c) => c.type === "text" && (c as Text).value.includes("\n:"),
      );
      if (nextIsDefPara || hasInlineDef) {
        const dlResult = tryConvertDefinitionList(
          children,
          i,
          schema,
          convertInlineChildren,
        );
        if (dlResult) {
          result.push(dlResult.node);
          i = dlResult.endIndex + 1;
          pendingColwidths = null;
          continue;
        }
      }
    }

    const node = convertBlockNode(child, schema);
    if (node) {
      if (Array.isArray(node)) {
        result.push(...node);
      } else {
        // §5.5: Apply pending colwidths to table node
        if (
          pendingColwidths &&
          child.type === "table" &&
          !Array.isArray(node)
        ) {
          // Count logical columns from first row of the table
          const firstRow = node.firstChild;
          let logicalCols = 0;
          if (firstRow) {
            firstRow.forEach((cell) => {
              logicalCols += (cell.attrs.colspan as number) || 1;
            });
          }
          // Only apply if colwidths length matches column count
          if (pendingColwidths.length === logicalCols) {
            result.push(applyColwidthsToTable(node, pendingColwidths));
          } else {
            result.push(node);
          }
          pendingColwidths = null;
        } else {
          result.push(node);
        }
      }
    }

    // Clear pendingColwidths if the current child was not a table
    if (child.type !== "table") {
      pendingColwidths = null;
    }

    i++;
  }

  return result;
}

/** Convert a single block-level mdast node to PM node(s) */
function convertBlockNode(
  node: Content,
  schema: Schema,
): null | PmNode | PmNode[] {
  // Special handling: paragraph with single image → block-level image
  if (isStandaloneImage(node)) {
    const imgNode = (node as { children: Content[] }).children[0];
    const transformer = nodeTransformers.get("image");
    if (transformer) {
      return transformer.mdastToPm(imgNode, schema, (parent) =>
        convertInlineChildren(
          (parent as { children: PhrasingContent[] }).children,
          schema,
          [],
        ),
      );
    }
  }

  // Tables — dedicated handler wraps cell inline children in paragraphs
  if (node.type === "table") {
    const transformer = nodeTransformers.get("table");
    if (transformer) {
      const result = transformer.mdastToPm(node, schema, (parent) => {
        const children = (parent as { children?: Content[] }).children;
        if (!children || children.length === 0) return [];
        const inlineContent = convertInlineChildren(
          children as PhrasingContent[],
          schema,
          [],
        );
        return [schema.nodes.paragraph.create(null, inlineContent)];
      });
      if (result && !Array.isArray(result)) return result;
    }
    // Fallback: minimal valid table
    const cell = schema.nodes.tableHeader.create(
      null,
      schema.nodes.paragraph.create(),
    );
    const row = schema.nodes.tableRow.create(null, [cell]);
    return schema.nodes.table.create(null, [row]);
  }

  // Lists — handle directly (bulletList/orderedList/taskList all share mdast type "list")
  if (node.type === "list") {
    return convertListNode(node, schema, convertBlockChildren);
  }

  // List items
  if (node.type === "listItem") {
    const transformer = nodeTransformers.get("listItem");
    if (transformer) {
      return transformer.mdastToPm(node, schema, (parent) =>
        convertBlockChildren(
          (parent as { children: Content[] }).children,
          schema,
        ),
      );
    }
  }

  // §5.5 Mermaid / §5.13 Query: code block with specific lang → dedicated block node
  if (node.type === "code") {
    const codeLang = (node as { lang?: string }).lang;
    for (const { lang, schemaNode, transformerKey } of CODE_LANG_MAP) {
      if (codeLang === lang && schema.nodes[schemaNode]) {
        const transformer = nodeTransformers.get(transformerKey);
        if (transformer) {
          return transformer.mdastToPm(node, schema, () => []);
        }
      }
    }
  }

  // §30b: Detect block embed — paragraph with single text child matching {{embed ((...))}}
  if (node.type === "paragraph" && schema.nodes.blockEmbed) {
    const children = (node as { children?: Content[] }).children;
    if (children?.length === 1 && children[0].type === "text") {
      const text = (children[0] as Text).value;
      const embedMatch = BLOCK_EMBED_RE.exec(text);
      if (embedMatch) {
        const parsed = parseBlockEmbedMatch(embedMatch);
        return schema.nodes.blockEmbed.create({
          target: parsed.target,
          blockId: parsed.blockId,
        });
      }
    }
  }

  // [TOC]: Detect table of contents — paragraph with single text child "[TOC]" or "[toc]"
  if (node.type === "paragraph" && schema.nodes.tableOfContents) {
    const children = (node as { children?: Content[] }).children;
    if (children?.length === 1 && children[0].type === "text") {
      const text = (children[0] as Text).value.trim();
      if (text === "[TOC]" || text === "[toc]") {
        return schema.nodes.tableOfContents.create();
      }
    }
  }

  // §5.9: Detect callout — blockquote whose first paragraph starts with [!type]
  if (node.type === "blockquote" && schema.nodes.callout) {
    const bqChildren = (node as { children: Content[] }).children;
    const firstChild = bqChildren[0];
    if (firstChild?.type === "paragraph") {
      const firstText =
        (
          (firstChild as { children: Content[] }).children[0] as
            Text | undefined
        )?.value || "";
      const firstLine = firstText.split("\n")[0];
      if (parseCalloutHeader(firstLine)) {
        const calloutT = pmNodeTransformers.get("callout");
        if (calloutT) {
          return calloutT.mdastToPm(node, schema, (parent) => {
            const children = (parent as { children?: Content[] }).children;
            if (!children) return [];
            const first = children[0];
            if (first && isInlineNode(first)) {
              return convertInlineChildren(
                children as PhrasingContent[],
                schema,
                [],
              );
            }
            return convertBlockChildren(children, schema);
          });
        }
      }
    }
  }

  // §30a: Extract block ID from paragraph/heading before conversion
  // Create a working copy to avoid mutating the original mdast node
  let workingNode = node;
  let blockId: null | string = null;
  if (node.type === "paragraph" || node.type === "heading") {
    const blockIdResult = extractBlockIdFromMdast(node);
    if (blockIdResult) {
      // Create a shallow copy with stripped children — no mutation of the original
      workingNode = {
        ...node,
        children: blockIdResult.strippedChildren,
      } as typeof node;
      blockId = blockIdResult.blockId;
    }
  }

  // Standard node transformer lookup
  const transformer = nodeTransformers.get(workingNode.type);
  if (transformer) {
    const result = transformer.mdastToPm(workingNode, schema, (parent) => {
      // If parent has inline children (heading, paragraph), use inline conversion
      const children = (parent as { children?: Content[] }).children;
      if (!children) return [];

      const firstChild = children[0];
      if (firstChild && isInlineNode(firstChild)) {
        return convertInlineChildren(children as PhrasingContent[], schema, []);
      }
      // Otherwise block-level
      return convertBlockChildren(children, schema);
    });

    // §30a: Inject blockId attribute if extracted and schema supports it
    if (blockId && result && !Array.isArray(result)) {
      if (result.type.spec.attrs && "blockId" in result.type.spec.attrs) {
        return result.type.create(
          { ...result.attrs, blockId },
          result.content,
          result.marks,
        );
      }
    }

    return result;
  }

  // Fallback: unknown node type → skip
  return null;
}

/** Convert inline mdast children to PM nodes with marks */
function convertInlineChildren(
  children: PhrasingContent[],
  schema: Schema,
  parentMarks: Mark[],
): PmNode[] {
  const result: PmNode[] = [];

  // Track HTML tag-based marks: <u>, <mark>, <sub>, <sup>
  // §perf-large-file: Only rebuild marks array when HTML mark state changes
  let underlineActive = false;
  let highlightActive = false;
  let subscriptActive = false;
  let superscriptActive = false;
  let marks = parentMarks;
  let htmlMarksDirty = false;

  for (const child of children) {
    if (child.type === "html") {
      const val = (child as { value: string }).value.trim().toLowerCase();
      if (val === "<u>") {
        underlineActive = true;
        htmlMarksDirty = true;
        continue;
      }
      if (val === "</u>") {
        underlineActive = false;
        htmlMarksDirty = true;
        continue;
      }
      if (val === "<mark>") {
        highlightActive = true;
        htmlMarksDirty = true;
        continue;
      }
      if (val === "</mark>") {
        highlightActive = false;
        htmlMarksDirty = true;
        continue;
      }
      if (val === "<sub>") {
        subscriptActive = true;
        htmlMarksDirty = true;
        continue;
      }
      if (val === "</sub>") {
        subscriptActive = false;
        htmlMarksDirty = true;
        continue;
      }
      if (val === "<sup>") {
        superscriptActive = true;
        htmlMarksDirty = true;
        continue;
      }
      if (val === "</sup>") {
        superscriptActive = false;
        htmlMarksDirty = true;
        continue;
      }
    }

    if (htmlMarksDirty) {
      marks = parentMarks;
      if (underlineActive && schema.marks.underline)
        marks = [...marks, schema.marks.underline.create()];
      if (highlightActive && schema.marks.highlight)
        marks = [...marks, schema.marks.highlight.create()];
      if (subscriptActive && schema.marks.subscript)
        marks = [...marks, schema.marks.subscript.create()];
      if (superscriptActive && schema.marks.superscript)
        marks = [...marks, schema.marks.superscript.create()];
      htmlMarksDirty = false;
    }
    const nodes = convertInlineNode(child, schema, marks);
    result.push(...nodes);
  }

  return result;
}

/** Convert a single inline mdast node to PM node(s) */
function convertInlineNode(
  node: PhrasingContent,
  schema: Schema,
  parentMarks: Mark[],
): PmNode[] {
  // Text node — split on @[[mention]] and [[wikilink]] patterns
  if (node.type === "text") {
    const text = node as Text;
    if (!text.value) return [];

    // §57: Check for mention patterns @[[...]] BEFORE wikilinks (superset of [[]])
    if (schema.nodes.mention && text.value.includes("@[[")) {
      const nodes = splitTextWithMentions(text.value, schema, parentMarks);
      if (nodes.length > 0) return nodes;
    }

    // Check for wikilink patterns and split if schema supports it
    if (schema.nodes.wikilink && text.value.includes("[[")) {
      const nodes = splitTextWithWikilinks(text.value, schema, parentMarks);
      if (nodes.length > 0) return nodes;
    }

    // §30b: Check for block reference patterns and split if schema supports it
    if (schema.nodes.blockReference && text.value.includes("((")) {
      const nodes = splitTextWithBlockRefs(text.value, schema, parentMarks);
      if (nodes.length > 0) return nodes;
    }

    // §56m: Check for #tag patterns and split if schema supports it
    if (schema.nodes.tagNode && text.value.includes("#")) {
      const nodes = splitTextWithTags(text.value, schema, parentMarks);
      if (nodes.length > 0) return nodes;
    }

    // Custom inline marks: ==highlight==, ^superscript^, ~subscript~
    const customMarkNodes = splitTextWithCustomInlineMarks(
      text.value,
      schema,
      parentMarks,
    );
    if (customMarkNodes.length > 0) return customMarkNodes;

    return [schema.text(text.value, parentMarks)];
  }

  // Inline code (leaf node in mdast, text with code mark in PM)
  if (node.type === "inlineCode") {
    const code = node as { value: string };
    const codeMark = schema.marks.code?.create();
    const marks = codeMark ? [...parentMarks, codeMark] : parentMarks;
    return [schema.text(code.value, marks)];
  }

  // Hard break
  if (node.type === "break") {
    return [schema.nodes.hardBreak.create()];
  }

  // Mark nodes (strong, emphasis, delete, link)
  const markTransformer = markTransformers.get(node.type);
  if (markTransformer) {
    const mark = markTransformer.mdastToMark(node, schema);
    if (mark) {
      const newMarks = [...parentMarks, mark];
      const children = (node as { children?: PhrasingContent[] }).children;
      if (children) {
        return convertInlineChildren(children, schema, newMarks);
      }
    }
  }

  // Inline math — §5.3
  if (node.type === "inlineMath") {
    const transformer = nodeTransformers.get("inlineMath");
    if (transformer) {
      const result = transformer.mdastToPm(node, schema, () => []);
      if (result && !Array.isArray(result)) return [result];
    }
  }

  // Footnote reference — §footnote
  if (node.type === "footnoteReference") {
    const fnRef = node as { identifier: string };
    if (schema.nodes.footnoteRef) {
      return [
        schema.nodes.footnoteRef.create({ identifier: fnRef.identifier }),
      ];
    }
  }

  // Image inline (rare, but possible)
  if (node.type === "image") {
    const transformer = nodeTransformers.get("image");
    if (transformer) {
      const result = transformer.mdastToPm(node, schema, () => []);
      if (result && !Array.isArray(result)) return [result];
    }
  }

  return [];
}

/** Check if an mdast node is inline-level */
function isInlineNode(node: Content): boolean {
  return INLINE_TYPES.has(node.type);
}
