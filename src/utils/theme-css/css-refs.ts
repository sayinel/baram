// §358 CSS 안에서 "자원의 이름" 이 어디에 나타나는가 — 테마 CSS 를 검사하는
// 쪽(`sanitize.ts`), 자산을 인라인하는 쪽(`inline-assets.ts`), 저장된 결과를 로드
// 시점에 다시 보는 쪽(`verify.ts`)이 함께 쓰는 원시 층.
//
// 세 쪽의 **정책은 다르다**: sanitize 는 패키지 상대 경로만 허용하고 `data:` 를
// 거부하며, inline 은 그 상대 경로를 `data:` 로 바꾸고, verify 는 `data:` 말고는
// 아무것도 받지 않는다. 여기 있는 것은 정책이 아니라 "무엇이 자원의 이름인가"
// 하나뿐이다 — 그 판정이 세 벌이 되면 한쪽만 고쳐진 채로 갈린다.
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

// 자원 이름을 받는 함수 **안에** 있지만 그 인자가 자원의 이름이 아닌 함수.
// `image-set()` 의 `type(<string>)` 은 media type 이다(CSS Images 4) — 브라우저는
// 그 문자열로 후보를 고를 뿐 그것을 가져오지 않는다. 자원으로 읽으면 합법한 테마가
// "없는 파일" 로 거부된다.
//
// ‼️ 그래서 이 예외는 신뢰하지 않는 입력에도 안전하다: 여기 면제되는 문자열은 애초에
// fetch 대상이 아니다. 쓰는 곳은 `inline-assets.ts`(참조 수집과 출력 스캔 양쪽)와
// `verify.ts` — **두 파일이 같은 집합을 봐야 한다.** 한쪽에만 있으면 인라인은
// 통과시킨 CSS 를 로드 시점에 verify 가 거부해, 설치는 되고 적용은 안 되는 테마가 생긴다.
//
// sanitize 는 이 예외를 쓰지 않는다 — 저자가 쓴 `type("https://evil.com/x.png")` 는
// 자원이 아니어도 그대로 거부된다.
export const NON_RESOURCE_ARGUMENT_FUNCTIONS: ReadonlySet<string> = new Set([
  "type",
]);

// 인자로 받은 맨 `<string>` 이 곧 자원의 이름이 되는 함수들. 그 인자는 `Url` 노드가
// 아니라 `String` 노드라서 Url 워크에 잡히지 않는다(실측).
//
// ‼️ **이 집합이 무엇을 가리는지 정확히.** `forEachResourceName` 은 `Url` **토큰**을
// 조건 없이 전부 방문한다 — 이 집합은 거기 관여하지 않는다. 집합이 관문 노릇을 하는 것은
// `String` 가지 하나뿐이다. 그래서 이 집합이 완전해야 하는 범위는 CSS 전체가 아니라
// **"함수 안의 맨 `<string>` 이 곧 가져올 자원의 이름이 되는 경우"** 이고, 그 범위에 대해
// 아래 다섯은 오늘 완전하다: `image-set()`(Images 4), `-webkit-image-set()`(그 별칭),
// `image()`(Images 4, `<image-src> = <url> | <string>`), `src()`(Values 5), 그리고
// `url()` 자신 — 값 자리 밖(미디어 특성 값 등)에서는 css-tree 가 `Url` 이 아니라
// `Function:url` 을 준다(실측).
//
// 문자열을 받지만 **그 문자열을 가져오지 않아** 일부러 뺀 것들(§359 최종 리뷰에서 하나씩
// 확인): `local()`(폰트 이름) · `format()`·`tech()`(형식 힌트) · `element()`(요소 id) ·
// `paint()`(paint worklet 이름) · `attr()`(속성 이름) · `var()`·`env()`(커스텀 속성 이름) ·
// `cross-fade()`(이미지를 받지 자원 이름을 받지 않는다). 이것들은 자원 이름이 아니므로
// 빠진 것이 맞다 — 그리고 그중 `local()` 안에 절대 URL 을 넣은 입력은 출력 스캔이 따로
// 잡는다(`sanitize.test.ts` "출력 스캔만이 잡는 것").
//
// ‼️ **열린 채로 남는 것 하나**: `-moz-image-set` 을 아직 별칭으로 인정하는 엔진이 있는지
// 확인하지 못했다. 있다면 여기 더해야 한다. "없다" 가 아니라 "모른다" 로 적는다.
//
// ‼️ 이 집합에 빠진 이름은 아래 `forEachResourceName` 의 `String` 가지가 놓친다. 그건 다른
// 층이 아니라 이 집합을 고쳐야 막힌다.
export const URL_BEARING_FUNCTIONS: ReadonlySet<string> = new Set([
  "-webkit-image-set",
  "image",
  "image-set",
  "src",
  "url",
]);

/**
 * 자원의 이름을 실어 나를 수 있는 토큰. 두 곳이 읽는다: `sanitize.ts` 는 `Raw` 안에서 이 중
 * 하나라도 보이면 그 조각이 검사되지 않은 참조를 숨기고 있을 수 있다고 본다(`Function` 까지
 * 넣는 이유는 `url( "x" )` 처럼 공백이 끼면 url-token 이 아니라 function-token 으로 쪼개지기
 * 때문이다). {@link forEachUrlBearingFunction} 은 URL 을 받는 함수의 인자에 이 중 하나라도
 * 있으면 `argument` 를 `null` 로 준다 — 그 인자의 판정을 이 방문이 하지 않는다는 표시일
 * 뿐, 안전하다는 말이 아니다(그 방문의 문서가 `url` 이라는 이름의 예외를 적는다).
 */
export const RESOURCE_NAMING_TOKENS: ReadonlySet<number> = new Set([
  csstree.tokenTypes.BadString,
  csstree.tokenTypes.BadUrl,
  csstree.tokenTypes.Function,
  csstree.tokenTypes.String,
  csstree.tokenTypes.Url,
]);

/**
 * computed-value 시점에 값이 정해지는 CSS 치환 함수.
 *
 * ‼️ `sanitize.ts` 에서 여기로 옮겼다(0090 최종 리뷰, M4). 이 집합과 위
 * {@link URL_BEARING_FUNCTIONS} 가 **함께** 한 규칙을 이루는데, 규칙을 sanitize 만
 * 갖고 있었고 verify 는 갖고 있지 않았다 — 이 파일 머리주석이 경계하는 "판정이 두 벌이
 * 되는" 모양 그대로다. 이제 아래 {@link substitutionInsideResourceName} 하나가 그
 * 판정이고 두 층이 같은 것을 부른다.
 */
export const SUBSTITUTION_FUNCTIONS: ReadonlySet<string> = new Set([
  "attr",
  "env",
  "var",
]);

/**
 * 자원 이름을 받는 함수 **안**(중첩 어디든)에 치환 함수가 있으면 그 자리를 돌려준다.
 *
 * ‼️ **왜 필요한가.** `--x:"https://e.com/x"; background:image-set(var(--x) 1x)` 에는
 * URL **토큰**이 하나도 없다 — 주소는 커스텀 속성 안의 문자열이고, 자원 자리에 도달하는
 * 것은 computed-value 시점이다. 그래서 `hasOnlyDataUrls` 의 토큰 스캔이 아무것도 보지
 * 못한다. 0090 최종 리뷰가 다섯 형태를 실측했다: `image-set(var())`,
 * `-webkit-image-set(var())`, `image(var())`, `src(var())`, `image-set(env() 1x)`.
 *
 * ‼️ **깊이는 "어디든" 이다.** sanitize 가 쓰던 walk 판정은 **바로 위** 함수만 봤고
 * (`this.function`), 그래서 `image-set(cross-fade(var(--x)) 1x)` 는 통과하는데 같은 자리에
 * 문자열을 직접 쓴 `image-set(cross-fade("https://…") 1x)` 는 문자열 스캔이 거부했다 —
 * 같은 개념에 두 깊이. 리뷰어는 `<image>` 문법상 전자가 무해할 것이라고 읽었지만
 * **브라우저로 측정하지는 않았다**. 측정하지 않은 무해함에 기대는 대신 닫는다: 문자열
 * 쪽과 같은 깊이 규칙(`forEachResourceName` 의 `bearing`)을 쓰면 두 규칙이 어긋날 자리가
 * 없어진다. 대가는 `cross-fade(var(--x))` 를 거부하는 것이고, 그 자리에 문자열을 쓰는
 * 형태는 이미 거부되므로 정당한 테마가 잃는 것은 없다.
 *
 * 토큰 스캔인 이유는 `forEachResourceName` 과 같다 — AST 워크는 파서가 `Raw` 로 남긴
 * 구간을 보지 못하고, 이 판정이 지키는 것은 사람이 편집할 수 있는 바이트다.
 *
 * 돌려주는 문자열은 오류 메시지용 위치 꼬리표다(`image-set(var())` 형태). null 은
 * "그런 자리가 없다" 이다.
 */
export function substitutionInsideResourceName(css: string): null | string {
  const stream = new csstree.TokenStream(css, csstree.tokenize);
  const open: Array<{ close: number; name: string }> = [];
  let found: null | string = null;
  stream.forEachToken((type, start, end, index) => {
    while (open.length > 0 && index >= open[open.length - 1].close) open.pop();
    if (type !== csstree.tokenTypes.Function) return;
    const name = cssName(css.slice(start, end - 1));
    const bearing = open.find((f) => URL_BEARING_FUNCTIONS.has(f.name));
    if (bearing !== undefined && SUBSTITUTION_FUNCTIONS.has(name)) {
      found ??= `${bearing.name}(${name}())`;
    }
    const close = stream.getBlockTokenPairIndex(index);
    open.push({
      close: close === -1 ? stream.tokenCount : close,
      name,
    });
  });
  return found;
}

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
 * "바로 위 함수" 규칙이 보지 못한다. 토큰 범위로 보면 그 두 부류가 다 잡힌다 — sanitize
 * 에서 이 관문만 빼면 말뭉치 중 33개가 열린다(실측). 측정 기록과, 인용되던 말뭉치 크기가
 * 아직 재현 가능한 이름을 못 가졌다는 사실: `dev/impl-notes/0050-theme-css-ablation-record.md`.
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
 * §394 Every function token whose decoded name is in {@link URL_BEARING_FUNCTIONS}, with what its
 * argument names (spec 0073 D9).
 *
 * ‼️ Why the token itself is a reference: css-tree 3.2.1's tokenizer compares a name's RAW spelling
 * with `url` before it makes a url token, and the browser compares the DECODED name (CSS Syntax,
 * consume an ident-like token). So `u\72l(//evil/x)` is a remote url token to the browser and a
 * function token plus loose tokens to css-tree — {@link forEachResourceName} visits none of it.
 * Measured: `sanitizeThemeCss` passed `u\72l(//evil/x)`, `u\72l(https\3a //evil/x)`,
 * `--x:u\72l(//evil/x)` used as `var(--x)` and `image-set(u\72l(//evil/x) 1x)`.
 *
 * `argument` is the argument read the way a url token's value is (`csstree.url.decode`, so
 * `https\3a //evil/x` reads `https://evil/x`) when the argument holds none of
 * {@link RESOURCE_NAMING_TOKENS}. Otherwise `null`, and `null` means only "this visit does not
 * judge the argument": a string or url inside is {@link forEachResourceName}'s (handing
 * `"data:…" 1x` whole to a `data:` check reads it as not `data:`), a nested function is visited
 * on its own turn, and a `BadString`/`BadUrl` is refused earlier by `assertWellFormed`.
 * `raw` is the token's span through its closing parenthesis.
 *
 * ‼️ `null` is a safe hand-off for `image-set`, `-webkit-image-set`, `image` and `src`, where
 * css-tree and the browser both make a function token. It is NOT for the decoded name `url`: the
 * browser makes a function token only when the first non-whitespace token after `(` is a string
 * (CSS Syntax, consume an ident-like token) and otherwise a url or bad-url token, so after
 * `u\72l(a");}b{background:url(https://evil/x)}c{x:")}` css-tree sees one string where the browser
 * sees the rule `b` (measured in headless Chrome). A caller must judge a `url` visit from `raw`,
 * not from `argument`.
 *
 * Policy is the caller's: the theme sanitizer judges `argument` with `isRemoteUrl` and refuses a
 * `url` visit that does not open with a string; the plugin CSS sanitizer refuses every visit
 * whatever the argument. For themes `verifyStoredThemeCss` (`hasUrlSpelledAsFunction`) stays the
 * gate on install and load.
 */
export function forEachUrlBearingFunction(
  css: string,
  visit: (name: string, argument: null | string, raw: string) => void,
): void {
  const stream = new csstree.TokenStream(css, csstree.tokenize);
  stream.forEachToken((type, start, end, index) => {
    if (type !== csstree.tokenTypes.Function) return;
    const name = cssName(css.slice(start, end - 1));
    if (!URL_BEARING_FUNCTIONS.has(name)) return;
    // No pair means the function stays open to EOF.
    const pair = stream.getBlockTokenPairIndex(index);
    const close = pair === -1 ? stream.tokenCount : pair;
    let plain = true;
    for (let i = index + 1; i < close; i++) {
      if (RESOURCE_NAMING_TOKENS.has(stream.getTokenType(i))) {
        plain = false;
        break;
      }
    }
    const argumentEnd = pair === -1 ? css.length : stream.getTokenStart(pair);
    const rawEnd = pair === -1 ? css.length : stream.getTokenEnd(pair);
    visit(
      name,
      plain ? csstree.url.decode(`url(${css.slice(end, argumentEnd)})`) : null,
      css.slice(start, rawEnd),
    );
  });
}

/**
 * 이 참조가 `data:` URI 인가. scheme 판정은 URL 파서가 한다 — `startsWith("data:")`
 * 는 `\64 ata:` 와 앞뒤 공백에 뚫리고, 이 리포는 같은 이유로 scheme 의 regex 재구현을
 * 금지한다(`link-href.ts`).
 */
export function isDataUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "data:";
  } catch {
    return false;
  }
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
