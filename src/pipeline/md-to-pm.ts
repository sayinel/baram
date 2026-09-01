// md-to-pm.ts — §3.3 Markdown → ProseMirror Document 변환 파이프라인
//
// Public API + orchestrator. Implementation details are split into:
//   convert-inline-text.ts       — text splitting for inline patterns
//   convert-inline.ts            — inline mdast children → PM node conversion
//   convert-list.ts              — list node conversion
//   convert-block-special.ts     — toggle, definition list, block ID extraction
//   convert-table-colwidths.ts   — colwidths HTML comment → table cell attrs
//
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Content, PhrasingContent, Root, Text } from "mdast";

import { classifyMediaSrc } from "../utils/media-src";
import { BLOCK_EMBED_RE, parseBlockEmbedMatch } from "./block-id";
import {
  extractBlockIdFromMdast,
  isDefinitionParagraph,
  tryConvertDefinitionList,
  tryConvertToggle,
} from "./convert-block-special";
import { convertInlineChildren } from "./convert-inline";
import { convertListNode } from "./convert-list";
import { applyColwidthsToTable, COLWIDTHS_RE } from "./convert-table-colwidths";
import { parseMdastAsync } from "./parse-async";
import { enrichWithEmptyParagraphs, parseMdast } from "./parse-mdast";
import { nodeTransformers } from "./transformers";
import { parseCalloutHeader } from "./transformers/callout-transformer";
import {
  isStandaloneImage,
  parseImgHtml,
} from "./transformers/image-transformer";
import { inlineMediaParagraphSource } from "./transformers/media-html-tag";
import { isDetailsOpening } from "./transformers/toggle-transformer";
import {
  isVideoHtmlPair,
  joinVideoHtmlPair,
  parseVideoHtml,
} from "./transformers/video-transformer";

// §5.5 Mermaid / §5.13 Query: code block lang → dedicated block node mapping
// Moved to module scope to avoid per-call allocation inside convertBlockNode
const CODE_LANG_MAP = [
  { lang: "mermaid", schemaNode: "mermaidBlock", transformerKey: "mermaid" },
  { lang: "query", schemaNode: "queryBlock", transformerKey: "query" },
  { lang: "svg", schemaNode: "svgBlock", transformerKey: "svg" },
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

    // §294: <video> html → video 노드. parseVideoHtml이 화이트리스트를 강제한다.
    if (child.type === "html" && schema.nodes.video) {
      const videoAttrs = parseVideoHtml((child as { value: string }).value);
      if (videoAttrs) {
        result.push(schema.nodes.video.create(videoAttrs));
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
  // Special handling: paragraph with single image → block-level image or video
  if (isStandaloneImage(node)) {
    const imgNode = (node as { children: Content[] }).children[0];
    // §294 동영상은 같은 `![](…)` 문법을 쓴다 — src가 노드 타입을 정한다.
    const isVideo =
      schema.nodes.video &&
      classifyMediaSrc((imgNode as { url?: string }).url ?? "") !== "image";
    const transformer = nodeTransformers.get(isVideo ? "video" : "image");
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

  // §294: 한 줄 `<video …></video>`는 CommonMark HTML-block 태그 목록에 video가
  // 없어서(iframe과 다르게) block html이 아니라 paragraph 안 인라인 html 조각
  // 두 개(여는/닫는 태그)로 쪼개진다. 다시 합쳐 parseVideoHtml에 넘긴다.
  if (isVideoHtmlPair(node)) {
    const joined = joinVideoHtmlPair(node);
    if (schema.nodes.video) {
      const videoAttrs = parseVideoHtml(joined);
      if (videoAttrs) {
        return schema.nodes.video.create(videoAttrs);
      }
    }
    // ‼️ 거부됐다고 그냥 지나치면 두 인라인 html 조각이 아래 일반 paragraph
    // 처리에서 조용히 사라진다(§294 I3) — 화이트리스트 밖으로 판정된 태그도
    // 사용자의 원문이다. htmlBlock으로 원문 그대로 보존한다.
    if (schema.nodes.htmlBlock) {
      return schema.nodes.htmlBlock.create({ content: joined });
    }
  }

  // §294 I6: 인라인 미디어 태그(`<img>`·`<video>`)가 **다른 인라인 내용과 함께**
  // 한 paragraph에 들어 있는 경우. 위 분기는 video 쌍만 있는 paragraph를 video
  // 노드로 바꾸고, 여기서는 원문을 되돌려 쓸 수 있을 때 paragraph 전체를
  // htmlBlock으로 보존한다. 앱이 리사이즈할 때마다 쓰는 태그 줄에 사용자가 글자
  // 하나를 타이핑하면 다음 저장에서 그 미디어가 사라지던 경로다 — 좁혀 둔 범위와
  // 이유는 inlineMediaParagraphSource의 주석에 있다.
  if (schema.nodes.htmlBlock) {
    const inlineMediaSource = inlineMediaParagraphSource(node);
    if (inlineMediaSource !== null) {
      return schema.nodes.htmlBlock.create({ content: inlineMediaSource });
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
        // §384 impl-review-1 (F3): read from `nodeTransformers` (the mdastType
        // → transformer map, this file's own registry for its actual MD→PM
        // direction), not `pmNodeTransformers` (the PM→mdast reverse map —
        // no legitimate MD→PM use needs it). Both key calloutTransformer
        // under the identical string "callout" (its mdastType AND pmType —
        // no other transformer claims mdastType "callout"), so this returns
        // the exact same object; only which map grants access changes.
        const calloutT = nodeTransformers.get("callout");
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

/** Check if an mdast node is inline-level */
function isInlineNode(node: Content): boolean {
  return INLINE_TYPES.has(node.type);
}
