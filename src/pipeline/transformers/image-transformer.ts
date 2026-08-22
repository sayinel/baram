import type { NodeTransformerEntry } from "../types";
import type { MediaHtmlAttrs, MediaTagSpec } from "./media-html-tag";
// image-transformer.ts — §5.1 Image mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Html, Image, Node as MdastNode, Paragraph } from "mdast";

import { buildMediaHtmlTag, parseMediaHtmlTag } from "./media-html-tag";

/**
 * `<img>` 태그의 문법·정책 (§294 I5).
 *
 * ‼️ `allowedAttrs`는 새 정책이다. 예전 `parseImgHtml`은 이름을 검사하지 않아서
 * `<img src="a.png" loading="lazy">`가 image 노드가 되고 저장할 때 `loading`이
 * 조용히 사라졌다. 이제 목록 밖 속성이 있으면 태그를 거부하고 htmlBlock으로
 * 원문 그대로 보존한다 — video 쪽이 이미 쓰던 정책이다.
 *
 * `supportsPixelWidth: true` — image 노드는 `widthPixel`을 선언하고
 * image-view가 그것을 실제로 그린다 (§294 I1 image parity). 잠깐 `false`였던
 * 적이 있다: 그때는 노드에 담을 자리가 없어서 픽셀 폭을 **거부**해야 값이 안
 * 사라졌는데, 거부는 곧 `<img src="a.png" width="640">`이 이미지로 안 그려지고
 * raw HTML 블록으로 떨어진다는 뜻이었다. 이미지는 동영상보다 훨씬 오래되고 훨씬
 * 많이 쓰인 기능이라 그 회귀가 더 아팠다 — 그려서 살리는 쪽이 아무것도 잃지 않는다.
 */
const IMG_TAG: MediaTagSpec = {
  allowedAttrs: new Set(["alt", "src", "title", "width"]),
  shape: "void",
  supportsPixelWidth: true,
  tagName: "img",
};

/**
 * Parse an `<img …>` HTML tag into ProseMirror image attributes.
 * Returns null when the tag cannot be represented losslessly — the caller
 * (md-to-pm.ts) then keeps the markup verbatim as an `htmlBlock`.
 */
export function parseImgHtml(html: string): MediaHtmlAttrs | null {
  return parseMediaHtmlTag(IMG_TAG, html);
}

/** Build an HTML `<img>` tag string from ProseMirror image attributes. */
function buildImgHtml(attrs: Record<string, unknown>): string {
  return buildMediaHtmlTag(IMG_TAG, attrs);
}

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
    const widthPercent = (node.attrs.widthPercent as number) || 100;
    const widthPixel = node.attrs.widthPixel as number | undefined;

    // When width is customized, serialize as HTML <img> to preserve size
    if (widthPercent !== 100 || widthPixel) {
      return {
        type: "html",
        value: buildImgHtml(node.attrs),
      } satisfies Html as MdastNode;
    }

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
