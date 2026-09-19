// §358 CSS 안에서 "자원의 이름" 이 어디에 나타나는가 — 테마 CSS 를 검사하는
// 쪽(`sanitize.ts`)과 자산을 인라인하는 쪽(`inline-assets.ts`)이 함께 쓰는 원시 층.
//
// 두 쪽의 **정책은 다르다**: sanitize 는 패키지 상대 경로만 허용하고 `data:` 를
// 거부하며, inline 은 그 상대 경로를 `data:` 로 바꾼다. 여기 있는 것은 정책이
// 아니라 "무엇이 자원의 이름인가" 하나뿐이다 — 그 판정이 두 벌이 되면 한쪽만
// 고쳐진 채로 갈린다.
//
// ‼️ 판정은 전부 파서가 준 것으로 한다. 문자열·정규식 검사는 CSS 이스케이프
// (`url(\68 ttp://…)`)와 대소문자·공백 변형에 뚫린다 — 이 리포는 링크 scheme
// 판정에서 같은 이유로 regex 재구현을 금지하고 있다(`utils/link-href.ts`).

import * as csstree from "css-tree";

// 상대 URL 을 해석해 볼 가짜 출처. 쌍 안에서는 host 만 다르고, 두 쌍 사이에서는
// scheme 이 다르다 — `isRemoteUrl` 이 두 쌍을 모두 쓰는 이유가 그 차이다.
const PROBE_BASES = ["https://a.invalid/theme/", "https://b.invalid/theme/"];

const PROBE_BASES_OPAQUE = [
  "baram-a://a.invalid/theme/",
  "baram-b://b.invalid/theme/",
];

// 인자로 받은 맨 `<string>` 이 곧 자원의 이름이 되는 함수들. 그 인자는 `Url` 노드가
// 아니라 `String` 노드라서 Url 워크에 잡히지 않는다(실측).
//
// ‼️ 이 집합은 구멍의 모양 자체다 — CSS 가 문자열을 자원 이름으로 받는 함수를 새로 얻을
// 때마다 여기에 더해야 한다. 오늘 아는 것: `image-set()`(Images 4), `image()`(Images 4,
// `<image-src> = <url> | <string>`), `src()`(Values 5), 그리고 `url()` 자신 — 값 자리
// 밖(미디어 특성 값 등)에서는 css-tree 가 `Url` 이 아니라 `Function:url` 을 준다(실측).
//
// ‼️ 이 집합에 빠진 이름은 아래 `forEachResourceName` 도 놓친다. 그건 다른 층이 아니라
// 이 집합을 고쳐야 막힌다.
export const URL_BEARING_FUNCTIONS: ReadonlySet<string> = new Set([
  "-webkit-image-set",
  "image",
  "image-set",
  "src",
  "url",
]);

/**
 * at-rule 이름과 함수 이름을 비교 가능한 형태로. **반드시 이것을 거쳐서 비교한다** —
 * css-tree 는 이름을 원문 그대로 준다(`@\69 mport` 는 AST 에서도 `\69 mport` 다).
 * 디코드하지 않고 비교하면 `@\69 mport "x.css"` 와 `\69 mage-set("https://…")` 가
 * 그대로 통과한다 — 실측했고, `\68 ttps:` 와 정확히 같은 부류의 함정이다.
 */
export function cssName(raw: string): string {
  return csstree.ident.decode(raw).toLowerCase();
}

/**
 * CSS 바이트 안에서 자원의 이름일 수 있는 값을 전부 훑는다 — 모든 `url()` 토큰과,
 * `URL_BEARING_FUNCTIONS` 안(**중첩 어디든**)의 문자열. 값은 파서의 디코더로 풀어서
 * 넘긴다.
 *
 * AST 워크가 아니라 토큰으로 보는 이유: 워크는 노드 **모양**을 열거하는데 그 열거가
 * 실제로 틀렸다. `@media (scripting:url("…"))` 에서 css-tree 는 `Url` 이 아니라
 * `Function:url` 을 주고, `image-set(local("https://…"))` 처럼 한 겹 더 감싸면 워크의
 * "바로 위 함수" 규칙이 보지 못한다. 토큰 범위로 보면 그 두 부류가 다 잡힌다
 * (실측: sanitize 에서 이 관문만 빼면 말뭉치 539개 중 33개가 열린다).
 *
 * `enclosing` 은 그 토큰을 **직접** 감싼 함수 이름(디코드·소문자)이다. 정책이 인자의
 * 문법을 알아야 할 때만 쓴다 — 예를 들어 `image-set()` 의 `type(<string>)` 은 media
 * type 이지 자원 이름이 아니다.
 */
export function forEachResourceName(
  css: string,
  visit: (value: string, raw: string, enclosing: null | string) => void,
): void {
  const stream = new csstree.TokenStream(css, csstree.tokenize);
  // 열려 있는 함수 프레임. 함수는 제대로 중첩되므로 닫힘 인덱스를 지나면 버린다.
  const open: Array<{ close: number; name: string }> = [];
  stream.forEachToken((type, start, end, index) => {
    while (open.length > 0 && index >= open[open.length - 1].close) open.pop();
    const raw = css.slice(start, end);
    if (type === csstree.tokenTypes.Function) {
      const close = stream.getBlockTokenPairIndex(index);
      // 짝이 없으면 EOF 까지 열려 있었다는 뜻이다.
      open.push({
        close: close === -1 ? stream.tokenCount : close,
        name: cssName(raw.slice(0, -1)),
      });
      return;
    }
    const bearing = open.some((f) => URL_BEARING_FUNCTIONS.has(f.name));
    const value =
      type === csstree.tokenTypes.Url
        ? csstree.url.decode(raw)
        : type === csstree.tokenTypes.String && bearing
          ? csstree.string.decode(raw)
          : null;
    if (value === null) return;
    visit(value, raw, open.length === 0 ? null : open[open.length - 1].name);
  });
}

/**
 * 이 참조가 테마 패키지 밖을 가리키는가. 판정은 WHATWG URL 파서가 한다 —
 * `link-href.ts` 와 같은 이유로: 브라우저가 실제로 돌리는 파서만이 탭·개행·앞뒤
 * 공백을 지우고 scheme 을 소문자로 접은 뒤의 의미를 안다.
 *
 * 규칙은 "base 를 바꿔도 안 움직이면 우리 밖" 이고, **쌍을 둘 쓴다.** 한 쌍만으로는
 * 값의 scheme 이 그 쌍의 scheme 과 같을 때 뚫린다 — `https:evil.com/x` 는 `https:`
 * base 에서는 상대 참조로 움직이지만 `baram-a:` base 에서는 절대 URL 로 고정된다.
 * 반대로 `\\evil.com\x` 는 special scheme(`https:`) 에서만 authority 로 바뀌므로
 * `https:` 쌍이 잡는다. 둘 중 한 쌍이라도 고정되면 거부한다.
 *
 * ‼️ 루트 절대 경로(`/x.png`)는 base 마다 다른 href 를 내므로 여기서는 **상대**다.
 * 패키지 안의 파일이 아니라는 판정은 경로 검사(`inline-assets.ts`)가 따로 한다.
 */
export function isRemoteUrl(value: string): boolean {
  const pinnedTo = (bases: readonly string[]): boolean => {
    const [a, b] = bases.map((base) => new URL(value, base).href);
    return a === b;
  };
  try {
    return pinnedTo(PROBE_BASES) || pinnedTo(PROBE_BASES_OPAQUE);
  } catch {
    // base 를 줘도 해석되지 않는 형태 — 모르는 것은 거부한다.
    return true;
  }
}

/** 로그용 위치 꼬리표. `positions: true` 로 파싱했으므로 거의 항상 붙는다. */
export function where(node: csstree.CssNode): string {
  return node.loc ? ` (${node.loc.start.line}:${node.loc.start.column})` : "";
}
