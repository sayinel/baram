import type { MarkTransformerEntry } from "../types";
import type { Schema } from "@tiptap/pm/model";
// simple-mark-transformer.ts — §5.1 팩토리: mdastType + pmMarkType만 다른 단순 mark transformer 생성
import type { Node as MdastNode, PhrasingContent } from "mdast";

export function createSimpleMarkTransformer(
  mdastType: string,
  pmMarkType: string,
): MarkTransformerEntry {
  return {
    mdastType,
    pmMarkType,

    mdastToMark(_node: MdastNode, schema: Schema) {
      return schema.marks[pmMarkType].create();
    },

    markToMdast(_mark, children: MdastNode[]): MdastNode {
      return {
        type: mdastType,
        children: children as PhrasingContent[],
      } as unknown as MdastNode;
    },
  };
}
