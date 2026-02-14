// image-transformer.ts — §5.1 Image mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode, Image, Paragraph } from "mdast";
import type { NodeTransformerEntry } from "../types";

export const imageTransformer: NodeTransformerEntry = {
  mdastType: "image",
  pmType: "image",

  mdastToPm(node: MdastNode, schema: Schema) {
    const img = node as Image;
    return schema.nodes.image.create({
      src: img.url,
      alt: img.alt || null,
      title: img.title || null,
    });
  },

  pmToMdast(node: PmNode): MdastNode {
    return {
      type: "image",
      url: node.attrs.src as string,
      alt: (node.attrs.alt as string) || undefined,
      title: (node.attrs.title as string) || null,
    } as Image;
  },
};

/**
 * mdast에서 image는 inline이지만 standalone paragraph 안에 있으면
 * ProseMirror에서는 block-level image로 변환한다.
 * 이 함수는 paragraph 내 단독 이미지를 감지한다.
 */
export function isStandaloneImage(node: MdastNode): boolean {
  if (node.type !== "paragraph") return false;
  const para = node as Paragraph;
  return para.children.length === 1 && para.children[0].type === "image";
}
