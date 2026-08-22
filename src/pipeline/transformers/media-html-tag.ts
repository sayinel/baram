// media-html-tag.ts — §294 I5 `<img>`·`<video>` HTML 태그의 공유 파서·빌더
//
// ‼️ image-transformer.ts와 video-transformer.ts가 각자 갖고 있던 같은 코드를
// 하나로 합친 것이다. 사본이 둘이던 동안 폭 검증 결함(§294 C1)이 양쪽에 따로
// 살아 있었고, 알 수 없는 속성 정책은 이미 갈라져 있었다 — video는 태그 전체를
// 거부했고 image는 속성을 조용히 버렸다(`<img src="a.png" loading="lazy">`가
// `loading`을 잃었다). 파싱·정책·이스케이프를 여기 한 곳에만 둬서 다음 수정이
// 양쪽에 동시에 닿는다.
//
// 이 모듈의 유일한 정책은 **표현할 수 없으면 거부한다**다. 거부(null)는 태그를
// htmlBlock으로 원문 그대로 남긴다(md-to-pm.ts) — 값을 깎아서 받아 두면 저장할 때
// 사용자 파일이 조용히 바뀐다.

import type { Html, Node as MdastNode, Paragraph, Text } from "mdast";

/** `<img>`/`<video>` 태그에서 PM 노드 attr로 옮겨지는 속성 집합. */
export interface MediaHtmlAttrs {
  alt: null | string;
  src: string;
  title: null | string;
  widthPercent: number;
  widthPixel?: number;
}

/**
 * 미디어 태그 하나의 문법과 정책. 파서와 빌더가 같은 값을 보도록 한 곳에 묶는다 —
 * 예전에는 태그 이름과 self-closing 여부가 두 함수에 각각 하드코딩돼 있었다.
 */
export interface MediaTagSpec {
  /** 허용 속성 이름. 목록 밖 이름이 하나라도 있으면 태그 전체를 거부한다. */
  allowedAttrs: ReadonlySet<string>;
  /** `void` = `<img …/>`(닫는 태그 없음), `paired` = `<video …></video>`. */
  shape: "paired" | "void";
  /**
   * 픽셀 폭을 담을 attr(`widthPixel`)이 대상 노드에 있는가. 없으면 픽셀 폭을
   * **거부한다** — 받아 두면 PM이 `create()`에서 모르는 키를 버리고 저장할 때
   * 사용자가 쓴 `width="640"`이 사라진다(§294 C1과 같은 손실).
   */
  supportsPixelWidth: boolean;
  tagName: string;
}

/** 폭 attr 쌍. 둘은 배타적이다 — 픽셀 폭이 있으면 퍼센트는 기본값 100이다. */
interface WidthAttrs {
  widthPercent: number;
  widthPixel?: number;
}

/**
 * remark가 이미 풀어 놨을 수 있는 표기. 이 글자가 text 자식에 있으면 원문 복원을
 * 포기한다 ({@link inlineMediaParagraphSource}) — `&amp;`는 `&`로, `\*`는 `*`로
 * 들어오므로 우리가 다시 써도 원문 바이트와 달라진다.
 */
const DECODED_TEXT_RE = /[&\\]/;

/**
 * paragraph 안의 인라인 html 조각이 **실제 미디어 요소**인지 판정한다 (§294 I6).
 *
 * ‼️ `src=`를 요구하는 것이 핵심이다. 닫는 태그 유무로는 판정할 수 없다: `img`는
 * void 요소라 닫는 태그가 아예 **없다**. 그렇다고 여는 태그 이름만 보면 산문이
 * 걸린다 — "use the `<video>` tag for clips"처럼 태그 이름을 **말하는** 문장까지
 * 통째로 raw html 블록이 되어 편집할 수 없게 된다(로컬 이미지를 안 보이게 만들었던
 * 것과 같은 종류의 회귀다). src를 든 태그만이 앱이 실제로 쓰는 모양이고, 잃을
 * 데이터가 있는 모양이다.
 *
 * 뮤테이션 테스트가 이 설계를 끌어냈다: 처음엔 video에 닫는 태그를 요구했는데,
 * 그 요구를 없애도 빨개지는 테스트가 없었다 — 닫는 태그는 "요소냐 산문이냐"를
 * 가리지 못하기 때문이다. src가 가린다.
 */
const MEDIA_TAG_OPEN_RES: readonly RegExp[] = [
  /^<img\s[^>]*\bsrc\s*=/i,
  /^<video\s[^>]*\bsrc\s*=/i,
];

/** 폭 속성이 아예 없는 태그의 기본값 — 100%는 마크다운 `![](src)`로 나간다. */
const DEFAULT_WIDTH: Readonly<WidthAttrs> = { widthPercent: 100 };

/** `width="60%"` — 퍼센트. 값 범위(1..100)는 `parseWidthValue`가 따로 본다. */
const WIDTH_PERCENT_RE = /^(\d+)%$/;

/** `width="640"` — 맨숫자는 픽셀이다 (HTML `<img>`/`<video>` 자신의 의미). */
const WIDTH_PIXEL_RE = /^(\d+)$/;

/** PM 미디어 attrs → `<img …/>` 또는 `<video …></video>` 문자열. */
export function buildMediaHtmlTag(
  spec: MediaTagSpec,
  attrs: Record<string, unknown>,
): string {
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
  const body = parts.join(" ");
  return spec.shape === "void"
    ? `<${spec.tagName} ${body} />`
    : `<${spec.tagName} ${body}></${spec.tagName}>`;
}

/**
 * 인라인 미디어 태그를 담은 paragraph의 **원문**. 그대로 되돌려 쓸 수 없으면 null.
 *
 * 왜 필요한가 (§294 I6): `convertInlineNode`에는 알 수 없는 인라인 `html` mdast
 * 노드를 통과시키는 경로가 없다 — `<span>`, `<b>`, 오늘의 `<u>/<mark>/<sub>/<sup>`
 * 밖의 모든 태그가 그냥 사라진다. 오래된 백로그 항목이고 미디어와 무관하게
 * 그랬다. 달라진 것은 노출이다: **앱이** 리사이즈할 때마다 파일에 태그를 쓴다 —
 * video는 `<video src="…" width="60%"></video>`, image는 `<img src="…"
 * width="60%" />`(`pmToMdast`가 `widthPercent !== 100 || widthPixel`이면
 * 언제나 그렇게 쓴다). 두 태그 다 혼자 한 줄에 있으면 왕복하지만, CommonMark
 * type-7 HTML 블록은 **paragraph를 끊지 못한다** — 그 줄에 글자를 하나 타이핑하거나
 * 위의 빈 줄을 지우는 순간 인라인 html 조각이 되고, 다음 저장에서 통째로 사라진다.
 * 앱이 만든 내용이 없어지는 것이다. 그래서 파서와 같은 정책을 쓴다: 표현할 수
 * 없으면 거부하고 원문을 남긴다.
 *
 * ‼️ 두 가지로 좁혀져 있고, 둘 다 의도한 것이다.
 *
 * 1. **자식 종류** — `text`/`html` 자식만으로 이뤄질 때만 복원한다. 파이프라인은
 *    원본 마크다운 문자열을 여기까지 넘기지 않으므로(position offset을 슬라이스할
 *    소스가 없다) 마크가 섞인 paragraph는 바이트 단위로 되돌릴 수 없다.
 *    {@link DECODED_TEXT_RE}가 걸리는 text도 같은 이유로 거부한다.
 * 2. **미디어 태그** — {@link MEDIA_TAG_OPEN_RES}가 잡는 `src`를 든 `<img>`·
 *    `<video>` 여는 태그가 하나라도 있어야 한다. `<span>`/`<b>`만 있는
 *    paragraph, 그리고 태그 이름을 **말하는** 산문(`use the <video> tag`)은 여기서
 *    보존되지 않는다 — 앞의 손실은 미디어와 무관한 기존 한계이고(테스트가 그대로
 *    고정한다), 뒤는 편집 가능한 단락을 raw html로 굳히지 않으려는 의도다.
 *
 * 되돌릴 수 없으면 null — 그 모양은 지금까지의 (손실 있는) 경로에 그대로 남는다.
 */
export function inlineMediaParagraphSource(node: MdastNode): null | string {
  if (node.type !== "paragraph") return null;
  let hasMedia = false;
  let source = "";
  for (const child of (node as Paragraph).children) {
    if (child.type === "html") {
      const value = (child as Html).value;
      const trimmed = value.trim();
      if (MEDIA_TAG_OPEN_RES.some((re) => re.test(trimmed))) hasMedia = true;
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
  return hasMedia ? source : null;
}

/**
 * `<img …>`/`<video …>` 태그 → PM 미디어 attrs. 표현할 수 없으면 null.
 *
 * 거부 조건은 셋이다: 태그 모양이 안 맞음, 허용 목록 밖의 속성 **이름**,
 * 되돌려 쓸 수 없는 `width` **값**. 세 번째가 §294 C1이었다 — 이름만 검사하고
 * 값은 검사하지 않아서 `width="150%"`가 통과한 뒤 `![](src)`로 나갔다.
 */
export function parseMediaHtmlTag(
  spec: MediaTagSpec,
  html: string,
): MediaHtmlAttrs | null {
  const match = tagRegExp(spec).exec(html);
  if (!match) return null;
  const attrStr = match[1];
  if (!hasOnlyAllowedAttrs(attrStr, spec.allowedAttrs)) return null;

  const src = getAttr(attrStr, "src");
  if (!src) return null;

  // ‼️ `null`(속성 없음)과 `""`(`width=""`)를 구분한다. 예전 코드는 `if (widthVal)`로
  // 둘을 같이 취급해서 빈 값을 100%로 삼켰고, 저장할 때 그 속성이 사라졌다.
  const widthVal = getAttr(attrStr, "width");
  const width =
    widthVal === null
      ? DEFAULT_WIDTH
      : parseWidthValue(widthVal, spec.supportsPixelWidth);
  if (!width) return null;

  return {
    src,
    alt: getAttr(attrStr, "alt") || null,
    title: getAttr(attrStr, "title") || null,
    ...width,
  };
}

function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** `attrStr`에서 `name="…"` 하나를 뽑는다. 속성이 없으면 null, 빈 값이면 `""`. */
function getAttr(attrStr: string, name: string): null | string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}="([^"]*)"`, "i");
  const m = attrStr.match(re);
  return m ? unescapeHtmlAttr(m[1]) : null;
}

/**
 * `attrStr`에 등장하는 모든 속성 이름이 허용 목록 안에만 있는지 검사한다.
 *
 * ‼️ 이 정규식은 홑따옴표·따옴표 없는 속성 문법을 **통째로 거부한다**: `src='a.mp4'`는
 * 값 쪽 그룹이 안 붙어서 `src` 다음에 `a.mp4`라는 엉뚱한 이름 토큰이 하나 더
 * 잡히고, 그게 목록에 없어서 false가 된다. 의도한 보수성이다 — 그 모양들은
 * htmlBlock으로 원문 그대로 살아남는다. 느슨하게 고치지 말 것.
 */
function hasOnlyAllowedAttrs(
  attrStr: string,
  allowed: ReadonlySet<string>,
): boolean {
  const attrNameRe = /([a-zA-Z_:][-\w:.]*)(?:\s*=\s*"[^"]*")?/g;
  let match: null | RegExpExecArray;
  while ((match = attrNameRe.exec(attrStr)) !== null) {
    if (!allowed.has(match[1].toLowerCase())) return false;
  }
  return true;
}

/**
 * `width` 속성 값 → 폭 attrs. 표현할 수 없으면 null(= 태그 전체 거부).
 *
 * 정책 (§294 C1):
 *  - 맨숫자는 **픽셀**이다 — HTML `<img width>`/`<video width>` 자신의 의미다.
 *    예전 코드는 100 이하의 맨숫자를 퍼센트로 재해석해서 사용자가 쓴
 *    `width="80"`을 파일에 `width="80%"`로 다시 써 넣었다.
 *  - `N%`는 퍼센트, 1..100.
 *  - 나머지는 전부 거부한다. **깎지 않는다**: `150%`를 `100%`로 재우거나
 *    `80.5%`를 `80%`로 자르는 것도 사용자 파일을 조용히 고치는 것이고, 원문을
 *    남기는 쪽이 언제나 안전하다.
 *  - 우리가 **같은 문자열로 되돌려 쓸 수 없는** 표기도 거부한다 — `080`(자릿수가
 *    달라진다), 20자리 정수(`String()`이 지수 표기로 접힌다). `buildMediaHtmlTag`는
 *    숫자를 다시 십진수로 찍으므로, 이 자기검사가 곧 왕복 보장이다.
 */
function parseWidthValue(
  raw: string,
  supportsPixelWidth: boolean,
): null | WidthAttrs {
  const pct = WIDTH_PERCENT_RE.exec(raw);
  if (pct) {
    const n = Number(pct[1]);
    if (String(n) !== pct[1]) return null;
    return n >= 1 && n <= 100 ? { widthPercent: n } : null;
  }

  const px = WIDTH_PIXEL_RE.exec(raw);
  if (px) {
    if (!supportsPixelWidth) return null;
    const n = Number(px[1]);
    if (String(n) !== px[1]) return null;
    return n >= 1 ? { widthPercent: 100, widthPixel: n } : null;
  }

  return null;
}

/**
 * 태그 모양 정규식. 속성 값 안의 `>`는 `[^>]`가 넘지 못하므로 그런 태그는
 * 거부된다 — 우리가 쓸 때는 `escapeHtmlAttr`가 `&gt;`로 내보내므로 스스로
 * 만들어 놓고 못 읽는 모양은 없다.
 */
function tagRegExp(spec: MediaTagSpec): RegExp {
  const tail =
    spec.shape === "void"
      ? String.raw`\s*\/?>`
      : String.raw`\s*(?:\/>|>\s*<\/${spec.tagName}>)`;
  return new RegExp(`^<${spec.tagName}\\s+([^>]*?)${tail}$`, "i");
}

function unescapeHtmlAttr(s: string): string {
  return s
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}
