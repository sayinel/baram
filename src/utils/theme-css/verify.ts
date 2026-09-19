// §358 저장된 테마 CSS 를 로드 시점에 다시 본다 — 주입 직전에 도는 두 번째 층이다.
//
// 설치 때 통과했다는 사실을 신뢰하지 않는다. 설치 시점의 위생은 **그때의 규칙**을
// 얼려 둘 뿐이다: 규칙을 강화해도 이미 설치된 테마에는 닿지 않고, 테마 폴더는 설치
// 뒤에 사람이 열어 볼 수 있는 디렉터리다. 같은 구조가 이 리포의 Pandoc 이미지 정책이다 —
// 세 층이고 각 층은 앞 층을 신뢰하지 않는다(CLAUDE.md).
//
// ‼️ **세 단계의 URL 규칙은 서로 다르다.** 그래서 여기서 `sanitizeThemeCss` 를 재사용할
// 수 없다 — 저장된 CSS 는 인라인화를 거쳐 `data:` 로 가득한데 sanitize 는 `data:` 를
// 거부하므로, 규칙을 빌려 오면 자산을 가진 테마가 전부 거부된다.
//   sanitize : 저자가 쓴 CSS → 패키지 상대 경로만. `data:` 는 **거부**
//   inline   : 설치 시점     → 그 상대 경로를 `data:` 로 **바꾼다**
//   verify   : 이 파일       → `data:` 만. 그 외 어떤 URL 도 거부
// (`THEME_LAYER_NAME` 만 sanitize 에서 가져온다 — 레이어 **이름**이지 규칙이 아니다.)
//
// 계약은 넷이고 전부 파서가 판정한다:
//   1. 최상위가 전부 `@layer baram-theme { … }` — 레이어 밖 선언은 앱 CSS 를 이긴다
//   2. 자원의 이름이 전부 `data:` — `type()` 인자만 예외다(css-refs.ts 가 그 이유를 적는다).
//      더불어 `url(` 이 **함수 토큰**으로 나타나면 거부한다 — 그 형태가 2 의 스캔을
//      통째로 우회하는 자리다(`hasUrlSpelledAsFunction` 이 실측과 함께 적는다)
//   3. `!important` 가 없다 — layered `!important` 는 unlayered 를 이긴다(Cascade 5),
//      즉 레이어로 감싸는 것만으로는 막히지 않는다(§359, sanitize 가 같은 이유로 제거한다)
//   4. `@import` 가 없다 — 설치 뒤에 임의의 CSS 를 끌어올 수 있는 통로다
//
// ‼️ 판정은 전부 파서가 준 것으로 한다. 문자열 검사는 CSS 이스케이프와 문법 변형에
// 뚫린다 — 이 §358 에서 실제로 두 번 새어 나갔고(`https:evil.com/x` 는 probe base 와
// scheme 이 같아 상대 참조로 읽혔고, `\75 rl(…)` 은 이름을 원문으로 비교해 통과했다),
// 둘 다 원문 텍스트를 비교한 자리였다.

import * as csstree from "css-tree";

import {
  cssName,
  forEachResourceName,
  isDataUrl,
  NON_RESOURCE_ARGUMENT_FUNCTIONS,
} from "./css-refs";
import { THEME_LAYER_NAME } from "./sanitize";

// 계약 2. 어디를 훑는지는 `forEachResourceName` 이 정하고 여기서는 정책만 건다 —
// 인라인화가 쓰는 출력 스캔과 **같은 순회, 같은 예외**다. 다르면 인라인이 통과시킨
// CSS 를 로드 시점에 거부하게 되고, 그 실패는 원인에서 두 단계 떨어진 곳에서 드러난다.
function hasOnlyDataUrls(css: string): boolean {
  let ok = true;
  forEachResourceName(css, (value, _raw, enclosing) => {
    if (enclosing !== null && NON_RESOURCE_ARGUMENT_FUNCTIONS.has(enclosing)) {
      return;
    }
    if (!isDataUrl(value)) ok = false;
  });
  return ok;
}

// 계약 2 의 나머지 절반. `url(` 이 **함수 토큰**으로 나타나는가.
//
// ‼️ 이것이 막는 것은 이름을 이스케이프한 url 이다. `\75 rl(https://e.com/x)` 를
// css-tree 토크나이저는 function-token + 잡토큰으로 쪼개므로 `forEachResourceName` 이
// **아무것도 보지 못한다**(실측). 브라우저는 반대다 — ident 를 디코드한 뒤 "url" 과
// 비교해 url-token 으로 읽고, 그 주소를 가져온다(CSS Syntax, consume an ident-like
// token). 그래서 이 한 줄이 없으면 위의 `data:` 전용 스캔이 통째로 우회된다.
// sanitize 는 같은 입력을 `parseFailed` 로 막지만(실측), verify 의 입력만은
// sanitize 를 거쳤다는 보장이 없다 — 그것이 이 층이 있는 이유다.
//
// 멀쩡한 테마를 거부하지 않는 근거는 구조가 먼저다: css-tree 의 `Url` **노드** 생성기는
// 언제나 url-token 을 낸다(`lib/syntax/node/Url.js` — `inline-assets.ts` 가 이미 인용한
// 그 근거다). 그래서 함수 철자가 살아남는 자리는 파서가 `Url` 노드를 **아예 만들지 않은**
// 자리뿐이다.
//
// ‼️ 그리고 그런 자리가 **있다** — 우리 인라인 단계도 거기서는 함수 철자를 쓴다.
// `@media (scripting:url("x.png"))` 의 media-feature 값은 느슨한 문법으로 파싱돼 `Url` 이
// 아니라 `Function:url` 이 되고(`css-refs.ts` 가 워크의 한계로 이미 적어 둔 그 경우다),
// 인라인이 거기 심은 `url("data:…")` 를 이 관문이 거부한다(실측). 그러니 "저장된 바이트의
// `url(` 함수 토큰은 우리가 쓴 것이 아니다" 로 읽으면 **안 된다.**
//
// 그래도 관문은 이대로 둔다. fail-closed 이고, 이 거부가 삼키는 것은 그 쿼리가 어차피
// 무효인 CSS 다(`scripting` 은 `none|initial-only|enabled` 만 받는다). 위치를 가려 받으려면
// 노드 **모양**을 다시 열거해야 하는데, 이 모듈이 두 번 열린 원인이 정확히 그 열거다.
//
// 쓸어 본 범위(sanitize → inline → verify 를 실제로 통과시켜 본 것): 선언 값 ·
// `@font-face src` · `image-set`·`-webkit-image-set`·`src`·`image` · `cursor` ·
// `list-style-image` · `@supports` 프렐류드 · `@namespace`·`@document`·`@container` ·
// `@media` **본문**(블록 안의 평범한 선언 값이다 — 프렐류드가 아니다) — 9위치 23철자.
// 함수 철자로 남은 것은 `@media` media-feature 값 둘뿐이고, `@supports (background:url(…))`
// 은 url-token 으로 되돌아온다(실측).
//
// ‼️ `@media` 가 두 자리를 내는 것처럼 읽지 말 것. 프렐류드에서 괄호 **밖**에 쓴 `url()` 은
// `Url` 도 `Function:url` 도 되지 않는다 — 파서가 그 구간을 통째로 `Raw` 로 남긴다(실측).
// 그러니 이 at-rule 이 기여하는 것은 깨진 feature 값 하나와, 위 목록의 `선언 값`과 같은
// 부류인 본문뿐이다.
//
// ‼️ **발견된 것이 그것 하나**라는 뜻이지 "그것뿐" 이 아니다 — css-tree 의 at-rule 문법표를
// 전수로 읽지는 않았다. 느슨하게 파싱되는 자리를 새로 발견하면 여기에 더할 것.
//
// (문자열을 인자로 받는 다른 함수 — `src(`·`image-set(`·`type(` — 는 함수 토큰 그대로
// 남지만 이 관문의 대상이 아니고, 그쪽 문자열은 위 `data:` 스캔이 본다.)
function hasUrlSpelledAsFunction(css: string): boolean {
  let found = false;
  const stream = new csstree.TokenStream(css, csstree.tokenize);
  stream.forEachToken((type, start, end) => {
    if (type !== csstree.tokenTypes.Function) return;
    // 함수 토큰의 원문은 여는 괄호를 포함한다 — css-refs 가 프레임 이름을 만드는 방식과 같다.
    if (cssName(css.slice(start, end - 1)) === "url") found = true;
  });
  return found;
}

// 계약 1. 이 최상위 노드가 우리 레이어 블록인가.
function isThemeLayer(node: csstree.CssNode): boolean {
  if (node.type !== "Atrule" || cssName(node.name) !== "layer") return false;
  // 이름만 선언하는 `@layer x;` 와 익명 `@layer { … }` 는 우리가 내보내는 형태가 아니다.
  if (node.prelude === null || node.block === null) return false;
  // ‼️ at-rule 이름과 달리 **레이어 이름은 대소문자를 가린다** — `<ident>` 이기 때문이다
  // (Cascade 5). 그래서 `cssName`(디코드 + 소문자) 이 아니라 디코드만 한다. 소문자로
  // 접어 비교하면 `@layer BARAM-THEME` 이 우리 레이어로 읽히는데 브라우저에게 그것은
  // **다른** 레이어이고, 나중에 선언된 레이어는 우리 것보다 뒤에 놓여 더 세게 이긴다.
  const name = csstree.generate(node.prelude).trim();
  return csstree.ident.decode(name) === THEME_LAYER_NAME;
}

/**
 * 저장된 테마 CSS 가 아직 계약을 지키는가. 지키지 않으면 주입하지 않는다.
 *
 * 던지지 않고 boolean 을 돌려주는 이유: 호출 시점이 **로드**다. 여기서 던지면 테마
 * 하나가 앱 시작을 막을 수 있고, 제작자가 고칠 기회는 이미 설치 때 지났다. 거부된
 * 테마는 CSS 없이 토큰만 적용된다(`applyThemeCss`).
 */
export function verifyStoredThemeCss(css: string): boolean {
  // 토큰 스캔이 먼저다. AST 워크가 보지 못하는 곳(파서가 포기한 `Raw` 조각)도
  // 훑으므로, 계약 2 만은 파싱 결과와 무관하게 CSS 전체에 걸린다.
  if (hasUrlSpelledAsFunction(css) || !hasOnlyDataUrls(css)) return false;

  let ast: csstree.CssNode;
  try {
    // 커스텀 속성 값까지 파싱한다 — 끄면 `--x:red !important` 의 값이 통째로 `Raw` 가
    // 되고, 계약 3·4 를 보는 아래 워크가 그 안을 들여다보지 못한다.
    ast = csstree.parse(css, { parseCustomProperty: true });
  } catch {
    // 파서는 보통 스스로 복구하지만, 복구하지 못한 입력을 통과시키지는 않는다.
    return false;
  }
  if (ast.type !== "StyleSheet") return false;
  if (!ast.children.toArray().every(isThemeLayer)) return false;

  let ok = true;
  csstree.walk(ast, (node) => {
    // ‼️ `!== false` 다. css-tree 는 `!important` 를 `true` 로 주지만, 이스케이프해
    // 적은 `!\69 mportant` 는 **그 원문 문자열**을 준다(실측) — 브라우저에게 둘은 같다.
    if (node.type === "Declaration" && node.important !== false) ok = false;
    if (node.type === "Atrule" && cssName(node.name) === "import") ok = false;
  });
  return ok;
}
