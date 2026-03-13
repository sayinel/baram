import type { NodeTransformerEntry } from "../types";
// image-transformer.ts — §5.1 Image mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Image, Node as MdastNode, Paragraph } from "mdast";

/** Parse an <img .../> HTML tag into ProseMirror image attributes.
 *  Returns null if the string is not an img tag. */
export function parseImgHtml(html: string): null | {
  alt: null | string;
  src: string;
  title: null | string;
  widthPercent: number;
  widthPixel?: number;
} {
  const match = html.match(/^<img\s+([^>]*?)\s*\/?>$/i);
  if (!match) return null;
  const attrStr = match[1];

  const getAttr = (name: string): null | string => {
    const re = new RegExp(`${name}="([^"]*)"`, "i");
    const m = attrStr.match(re);
    return m ? unescapeHtmlAttr(m[1]) : null;
  };

  const src = getAttr("src");
  if (!src) return null;

  let widthPercent = 100;
  let widthPixel: number | undefined;
  const widthVal = getAttr("width");
  if (widthVal) {
    if (widthVal.includes("%")) {
      const pct = parseInt(widthVal.replace("%", ""), 10);
      if (!isNaN(pct) && pct > 0 && pct <= 100) widthPercent = pct;
    } else {
      const px = parseInt(widthVal, 10);
      if (!isNaN(px) && px > 0) {
        if (px <= 100) {
          widthPercent = px;
        } else {
          widthPixel = px;
        }
      }
    }
  }

  return {
    src,
    alt: getAttr("alt") || null,
    title: getAttr("title") || null,
    widthPercent,
    widthPixel,
  };
}

/** Build an HTML <img> tag string from ProseMirror image attributes */
function buildImgHtml(attrs: Record<string, unknown>): string {
  const parts: string[] = [];
  if (attrs.src) parts.push(`src="${escapeHtmlAttr(String(attrs.src))}"`);
  if (attrs.alt) parts.push(`alt="${escapeHtmlAttr(String(attrs.alt))}"`);
  if (attrs.title) parts.push(`title="${escapeHtmlAttr(String(attrs.title))}"`);
  const px = attrs.widthPixel as number | undefined;
  if (px) {
    parts.push(`width="${px}"`);
  } else {
    const w = attrs.widthPercent as number;
    if (w && w !== 100) parts.push(`width="${w}%"`);
  }
  return `<img ${parts.join(" ")} />`;
}

function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function unescapeHtmlAttr(s: string): string {
  return s
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
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
      } as unknown as MdastNode;
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
