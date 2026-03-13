// Transformer registry — 모든 mdast ↔ ProseMirror 변환기 등록
import type { MarkTransformerEntry, NodeTransformerEntry } from "../types";

import { blockEmbedTransformer } from "./block-embed-transformer";
import { blockReferenceTransformer } from "./block-reference-transformer";
import { blockquoteTransformer } from "./blockquote-transformer";
import { boldTransformer } from "./bold-transformer";
import { bulletListTransformer } from "./bullet-list-transformer";
import { calloutTransformer } from "./callout-transformer";
import { codeBlockTransformer } from "./code-block-transformer";
import { codeTransformer } from "./code-transformer";
import { definitionListTransformer } from "./definition-list-transformer";
import { footnoteDefinitionTransformer } from "./footnote-definition-transformer";
import { footnoteRefTransformer } from "./footnote-ref-transformer";
import { frontmatterTransformer } from "./frontmatter-transformer";
import { headingTransformer } from "./heading-transformer";
import { highlightTransformer } from "./highlight-transformer";
import { horizontalRuleTransformer } from "./horizontal-rule-transformer";
import { imageTransformer } from "./image-transformer";
import { italicTransformer } from "./italic-transformer";
import { linkTransformer } from "./link-transformer";
import { listItemTransformer } from "./list-item-transformer";
import { mathBlockTransformer } from "./math-block-transformer";
import { mathInlineTransformer } from "./math-inline-transformer";
import { mentionTransformer } from "./mention-transformer";
import { mermaidBlockTransformer } from "./mermaid-block-transformer";
import { orderedListTransformer } from "./ordered-list-transformer";
import { paragraphTransformer } from "./paragraph-transformer";
import { queryBlockTransformer } from "./query-block-transformer";
import { strikeTransformer } from "./strike-transformer";
import { subscriptTransformer } from "./subscript-transformer";
import { superscriptTransformer } from "./superscript-transformer";
import { tableOfContentsTransformer } from "./table-of-contents-transformer";
import { tableTransformer } from "./table-transformer";
import { tagTransformer } from "./tag-transformer";
import { taskListTransformer } from "./task-list-transformer";
import { toggleTransformer } from "./toggle-transformer";

/** Node transformers — mdast type → transformer */
export const nodeTransformers: Map<string, NodeTransformerEntry> = new Map();

/** PM type → node transformer (역방향 조회) */
export const pmNodeTransformers: Map<string, NodeTransformerEntry> = new Map();

/** Mark transformers — mdast type → transformer */
export const markTransformers: Map<string, MarkTransformerEntry> = new Map();

/** PM mark type → mark transformer (역방향 조회) */
export const pmMarkTransformers: Map<string, MarkTransformerEntry> = new Map();

// Node 등록
const nodeEntries: NodeTransformerEntry[] = [
  headingTransformer,
  paragraphTransformer,
  blockquoteTransformer,
  bulletListTransformer,
  orderedListTransformer,
  listItemTransformer,
  taskListTransformer,
  horizontalRuleTransformer,
  imageTransformer,
  codeBlockTransformer,
  mathBlockTransformer,
  mathInlineTransformer,
  tableTransformer,
  frontmatterTransformer,
  mermaidBlockTransformer,
  queryBlockTransformer,
  blockReferenceTransformer,
  blockEmbedTransformer,
  calloutTransformer,
  toggleTransformer,
  footnoteRefTransformer,
  footnoteDefinitionTransformer,
  definitionListTransformer,
  tableOfContentsTransformer,
  mentionTransformer,
  tagTransformer,
];

for (const entry of nodeEntries) {
  nodeTransformers.set(entry.mdastType, entry);
  pmNodeTransformers.set(entry.pmType, entry);
}

// Mark 등록
const markEntries: MarkTransformerEntry[] = [
  boldTransformer,
  italicTransformer,
  codeTransformer,
  strikeTransformer,
  linkTransformer,
  highlightTransformer,
  subscriptTransformer,
  superscriptTransformer,
];

for (const entry of markEntries) {
  markTransformers.set(entry.mdastType, entry);
  pmMarkTransformers.set(entry.pmMarkType, entry);
}
