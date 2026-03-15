// Pipeline types — mdast ↔ ProseMirror 변환 공통 타입
import type { Mark, Node as PmNode, Schema } from "@tiptap/pm/model";
import type {
  Literal as MdastLiteral,
  Node as MdastNode,
  Parent as MdastParent,
} from "mdast";

// ---------------------------------------------------------------------------
// Custom mdast node types for Baram-specific inline nodes.
// Uses mdast's official module augmentation to register custom nodes into
// PhrasingContentMap, making them valid PhrasingContent without double casts.
// ---------------------------------------------------------------------------

/** §30b: Block reference inline node — `![[target#^blockId]]` */
export interface BlockReferenceNode extends MdastLiteral {
  type: "blockReference";
}

/** Highlight inline mark node — `==text==` (value-based, pre-serialized) */
export interface HighlightNode extends MdastLiteral {
  type: "highlight";
}

/** §57: @mention inline node — `@user` or `@file` */
export interface MentionNode extends MdastLiteral {
  type: "mention";
}

/** Subscript inline mark node — `~text~` (value-based, pre-serialized) */
export interface SubscriptNode extends MdastLiteral {
  type: "subscript";
}

/** Superscript inline mark node — `^text^` (value-based, pre-serialized) */
export interface SuperscriptNode extends MdastLiteral {
  type: "superscript";
}

/** §56m: Tag inline node — `#tag` */
export interface TagNode extends MdastLiteral {
  type: "tagNode";
}

/** §28: Wiki-link inline node — `[[target]]` or `[[target|display]]` */
export interface WikiLinkNode extends MdastLiteral {
  type: "wikiLink";
}

// Register custom inline nodes into mdast's PhrasingContentMap and RootContentMap.
// This makes them valid members of the PhrasingContent and RootContent unions automatically.
declare module "mdast" {
  interface PhrasingContentMap {
    blockReference: BlockReferenceNode;
    highlight: HighlightNode;
    mention: MentionNode;
    subscript: SubscriptNode;
    superscript: SuperscriptNode;
    tagNode: TagNode;
    wikiLink: WikiLinkNode;
  }

  interface RootContentMap {
    blockReference: BlockReferenceNode;
    highlight: HighlightNode;
    mention: MentionNode;
    subscript: SubscriptNode;
    superscript: SuperscriptNode;
    tagNode: TagNode;
    wikiLink: WikiLinkNode;
  }
}

// ---------------------------------------------------------------------------
// Transformer types
// ---------------------------------------------------------------------------

/** Mark → mdast 래핑 함수 */
export type MarkToMdastTransformer = (
  mark: Mark,
  children: MdastNode[],
) => MdastNode;

/** 마크 변환기 레지스트리 엔트리 */
export interface MarkTransformerEntry {
  markToMdast: MarkToMdastTransformer;
  mdastToMark: MdastToMarkTransformer;
  mdastType: string;
  pmMarkType: string;
}

/** mdast mark 노드 → PM Mark 변환 함수 */
export type MdastToMarkTransformer = (
  node: MdastNode,
  schema: Schema,
) => Mark | null;

/** mdast → ProseMirror 변환 함수 */
export type MdastToPmTransformer = (
  node: MdastNode,
  schema: Schema,
  convertChildren: (parent: MdastParent) => PmNode[],
) => null | PmNode | PmNode[];

/** 노드 변환기 레지스트리 엔트리 */
export interface NodeTransformerEntry {
  mdastToPm: MdastToPmTransformer;
  mdastType: string;
  pmToMdast: PmToMdastTransformer;
  pmType: string;
}

/** ProseMirror → mdast 변환 함수 */
export type PmToMdastTransformer = (
  node: PmNode,
  convertChildren: (node: PmNode) => MdastNode[],
) => MdastNode | null;
