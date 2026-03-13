// Pipeline types — mdast ↔ ProseMirror 변환 공통 타입
import type { Mark, Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode, Parent as MdastParent } from "mdast";

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
