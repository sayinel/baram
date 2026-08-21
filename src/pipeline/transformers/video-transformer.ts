import type { NodeTransformerEntry } from "../types";
// video-transformer.ts — §294 동영상 mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Html, Image, Node as MdastNode, Paragraph } from "mdast";

import { classifyMediaSrc } from "../../utils/media-src";

export interface VideoHtmlAttrs {
  alt: null | string;
  src: string;
  title: null | string;
  widthPercent: number;
  widthPixel?: number;
}

/** PM video attrs → `<video …></video>` 문자열. */
export function buildVideoHtml(attrs: Record<string, unknown>): string {
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
  return `<video ${parts.join(" ")}></video>`;
}

/**
 * `<video src="…"></video>`가 한 줄에 있으면 remark는 이를 block html로 보지
 * 않는다 — CommonMark HTML 블록 6번 태그 목록에 `video`가 없어서다(`iframe`은
 * 있다 — 그래서 iframe 테스트는 이 특례가 없어도 통과한다). 대신 paragraph 안에
 * 인접한 인라인 html 조각 두 개(여는 태그·닫는 태그)로 쪼개진다. §294가 그
 * 모양을 다시 합쳐 되돌려 받도록 여기서 감지한다.
 */
export function isVideoHtmlPair(node: MdastNode): boolean {
  if (node.type !== "paragraph") return false;
  const children = (node as Paragraph).children;
  return (
    children.length === 2 &&
    children[0].type === "html" &&
    children[1].type === "html" &&
    /^<video\s/i.test((children[0] as Html).value) &&
    (children[1] as Html).value.trim().toLowerCase() === "</video>"
  );
}

/** {@link isVideoHtmlPair}가 확인한 두 조각을 하나의 태그 문자열로 합친다. */
export function joinVideoHtmlPair(node: MdastNode): string {
  const children = (node as Paragraph).children;
  return (children[0] as Html).value + (children[1] as Html).value;
}

/**
 * `<video …>` 태그를 PM video attrs로 파싱한다.
 *
 * ‼️ `<video>`만 받고, 그 안에서도 src가 **동영상 파일**일 때만 수락한다.
 * provider URL이 담힌 `<video>`, 그리고 `<iframe>`은 전부 null → html-block으로
 * 떨어진다. 열거된 거부목록이 아니라 화이트리스트 방향이다 (§294, §298).
 */
export function parseVideoHtml(html: string): null | VideoHtmlAttrs {
  const match = html
    .trim()
    .match(/^<video\s+([^>]*?)\s*(?:\/>|>\s*<\/video>)$/i);
  if (!match) return null;
  const attrStr = match[1];

  const getAttr = (name: string): null | string => {
    const re = new RegExp(`${name}="([^"]*)"`, "i");
    const m = attrStr.match(re);
    return m ? unescapeHtmlAttr(m[1]) : null;
  };

  const src = getAttr("src");
  if (!src) return null;
  if (classifyMediaSrc(src) !== "video-file") return null;

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
        if (px <= 100) widthPercent = px;
        else widthPixel = px;
      }
    }
  }

  return {
    src,
    alt: getAttr("alt"),
    title: getAttr("title"),
    widthPercent,
    widthPixel,
  };
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

export const videoTransformer: NodeTransformerEntry = {
  mdastType: "video",
  pmType: "video",

  mdastToPm(node: MdastNode, schema: Schema) {
    const img = node as Image;
    return schema.nodes.video.create({
      src: img.url,
      alt: img.alt || null,
      title: img.title || null,
    });
  },

  pmToMdast(node: PmNode): MdastNode {
    const widthPercent = (node.attrs.widthPercent as number) || 100;
    const widthPixel = node.attrs.widthPixel as number | undefined;

    if (widthPercent !== 100 || widthPixel) {
      return {
        type: "html",
        value: buildVideoHtml(node.attrs),
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
