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
 * ‼️ `supportsPixelWidth: false` — image 노드(`src/extensions/nodes/image.ts`)에는
 * `widthPixel` attr이 없다. `width="640"`을 받아 두면 PM `create()`가 모르는 키를
 * 버리고 저장할 때 `![](src)`로 나가서 사용자가 손으로 쓴 폭이 사라진다. 대신
 * 거부해서 원문을 남긴다. image 노드에 `widthPixel`을 더하고 image-view가 그것을
 * 그리게 되면 이 플래그만 뒤집으면 된다.
 */
const IMG_TAG: MediaTagSpec = {
  allowedAttrs: new Set(["alt", "src", "title", "width"]),
  shape: "void",
  supportsPixelWidth: false,
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
