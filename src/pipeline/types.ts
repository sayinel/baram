// Pipeline types — mdast ↔ ProseMirror 변환 공통 타입
import type { Node as PmNode, Mark, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode, Parent as MdastParent } from "mdast";

/** mdast → ProseMirror 변환 함수 */
export type MdastToPmTransformer = (
  node: MdastNode,
  schema: Schema,
  convertChildren: (parent: MdastParent) => PmNode[],
) => PmNode | PmNode[] | null;

/** ProseMirror → mdast 변환 함수 */
export type PmToMdastTransformer = (
  node: PmNode,
  convertChildren: (node: PmNode) => MdastNode[],
) => MdastNode | null;

/** Mark → mdast 래핑 함수 */
export type MarkToMdastTransformer = (
  mark: Mark,
  children: MdastNode[],
) => MdastNode;

/** mdast mark 노드 → PM Mark 변환 함수 */
export type MdastToMarkTransformer = (
  node: MdastNode,
  schema: Schema,
) => Mark | null;

/** 노드 변환기 레지스트리 엔트리 */
export interface NodeTransformerEntry {
  mdastType: string;
  pmType: string;
  mdastToPm: MdastToPmTransformer;
  pmToMdast: PmToMdastTransformer;
}

/** 마크 변환기 레지스트리 엔트리 */
export interface MarkTransformerEntry {
  mdastType: string;
  pmMarkType: string;
  mdastToMark: MdastToMarkTransformer;
  markToMdast: MarkToMdastTransformer;
}
