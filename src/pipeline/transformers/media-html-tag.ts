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
