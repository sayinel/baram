import type { NodeTransformerEntry } from "../types";
import type { MediaHtmlAttrs, MediaTagSpec } from "./media-html-tag";
// video-transformer.ts — §294 동영상 mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Html, Image, Node as MdastNode, Paragraph, Text } from "mdast";

import { classifyMediaSrc } from "../../utils/media-src";
import { buildMediaHtmlTag, parseMediaHtmlTag } from "./media-html-tag";

/**
 * `<video>` 태그의 문법·정책 (§294 I4, I5).
 *
 * ‼️ `controls`, `poster` 등 `allowedAttrs` 밖의 속성이 하나라도 있으면
 * `parseVideoHtml`은 태그 전체를 거부한다 — 무시하고 넘어가면 그 속성이 조용히
 * 사라지기 때문이다. 거부된 태그는 md-to-pm.ts가 `htmlBlock`으로 원문 그대로
 * 보존한다.
 *
 * `supportsPixelWidth: true` — video 노드(`src/extensions/nodes/video.ts`)는
 * `widthPixel`을 선언하고 video-view가 그것을 실제로 그린다(§294 I1).
 */
const VIDEO_TAG: MediaTagSpec = {
  allowedAttrs: new Set(["alt", "src", "title", "width"]),
  shape: "paired",
  supportsPixelWidth: true,
  tagName: "video",
};

/** 인라인 html 조각이 여는 `<video …>` 태그인가. */
const VIDEO_OPEN_RE = /^<video(?=[\s/>])/i;

/** 인라인 html 조각이 닫는 `</video>` 태그인가. */
const VIDEO_CLOSE_RE = /^<\/video\s*>$/i;

/**
 * remark가 이미 풀어 놨을 수 있는 표기. 이 글자가 text 자식에 있으면 원문
 * 복원을 포기한다 ({@link inlineVideoParagraphSource}) — `&amp;`는 `&`로,
 * `\*`는 `*`로 들어오므로 우리가 다시 써도 원문 바이트와 달라진다.
 */
const DECODED_TEXT_RE = /[&\\]/;

/** PM video attrs → `<video …></video>` 문자열. */
export function buildVideoHtml(attrs: Record<string, unknown>): string {
  return buildMediaHtmlTag(VIDEO_TAG, attrs);
}

/**
 * `<video …>`/`</video>` 인라인 쌍을 담은 paragraph의 **원문**. 원문 그대로
 * 되돌려 쓸 수 없으면 null.
 *
 * 왜 필요한가 (§294 I6): `convertInlineNode`에는 알 수 없는 인라인 `html` mdast
 * 노드를 통과시키는 경로가 없다 — `<span>`, `<b>`, 오늘의 `<u>/<mark>/<sub>/<sup>`
 * 밖의 모든 태그가 그냥 사라진다. 오래된 백로그 항목이고 video와 무관하게
 * 그랬다. 달라진 것은 노출이다: 이제 **앱이** 동영상을 리사이즈할 때마다
 * `<video src="…" width="60%"></video>`를 파일에 쓴다. 그 줄에 글자를 하나
 * 타이핑하거나 리사이즈된 두 동영상 사이의 빈 줄을 지우면 다음 저장에서
 * 동영상이 통째로 사라진다 — 앱이 만든 내용이 없어지는 것이다. 그래서
 * `parseVideoHtml`과 같은 정책을 쓴다: 표현할 수 없으면 거부하고 원문을 남긴다.
 *
 * ‼️ 복원은 `text`/`html` 자식만으로 이뤄질 때만 한다. 파이프라인은 원본
 * 마크다운 문자열을 여기까지 넘기지 않으므로(position offset을 슬라이스할 소스가
 * 없다) 마크가 섞인 paragraph는 바이트 단위로 되돌릴 수 없다. {@link
 * DECODED_TEXT_RE}가 걸리는 text도 같은 이유로 거부한다. 되돌릴 수 없으면 null —
 * 그 모양은 지금까지의 (손실 있는) 경로에 그대로 남는다.
 */
export function inlineVideoParagraphSource(node: MdastNode): null | string {
  if (node.type !== "paragraph") return null;
  let hasOpen = false;
  let hasClose = false;
  let source = "";
  for (const child of (node as Paragraph).children) {
    if (child.type === "html") {
      const value = (child as Html).value;
      const trimmed = value.trim();
      if (VIDEO_OPEN_RE.test(trimmed)) hasOpen = true;
      if (VIDEO_CLOSE_RE.test(trimmed)) hasClose = true;
      source += value;
      continue;
    }
    if (child.type === "text") {
      const value = (child as Text).value;
      if (DECODED_TEXT_RE.test(value)) return null;
      source += value;
      continue;
    }
    return null;
  }
  return hasOpen && hasClose ? source : null;
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
 * provider URL이 담긴 `<video>`, 그리고 `<iframe>`은 전부 null → html-block으로
 * 떨어진다. 열거된 거부목록이 아니라 화이트리스트 방향이다 (§294, §298).
 * 폭 값 정책은 media-html-tag.ts의 `parseWidthValue` 하나에 있다 — image 쪽과
 * 공유한다.
 */
export function parseVideoHtml(html: string): MediaHtmlAttrs | null {
  // `.trim()`은 예전부터 이 쪽에만 있었다. img 쪽은 트림하지 않는다 —
  // 들여쓴 `<img …>`는 들여쓰기까지 원문이라 htmlBlock으로 남는 편이 맞다.
  const attrs = parseMediaHtmlTag(VIDEO_TAG, html.trim());
  if (!attrs) return null;
  if (classifyMediaSrc(attrs.src) !== "video-file") return null;
  return attrs;
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
