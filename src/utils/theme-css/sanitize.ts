// §358 테마 CSS 위생 — 설치 시점에 한 번 돌고, 그 결과가 저장되어 주입된다.
//
// ‼️ 판정은 전부 파서가 준 것으로 한다. 문자열·정규식 검사는 CSS 이스케이프
// (`url(\68 ttp://…)`)와 대소문자·공백 변형에 뚫린다 — 이 리포는 링크 scheme
// 판정에서 같은 이유로 regex 재구현을 금지하고 있다(`utils/link-href.ts`).
//
// 원격 자산을 막는 이유는 CSP가 막아 주지 않기 때문이다: `img-src` 에 `https:` 가
// 열려 있고(문서 안 원격 이미지가 정당한 기능이다) 전역으로 닫을 수 없다. 그래서
// 여기가 유일한 관문이다. `font-src`·`style-src` 는 CSP가 이미 닫아 두었지만,
// 그 사실에 기대지 않고 여기서도 거부한다 — CSP 는 언제든 완화될 수 있다.
//
// ‼️ 관대한 파서는 열린 문이다. css-tree 는 `a{color:red` 를 조용히 닫고 성공을
// 돌려주며 `onParseError` 도 부르지 않는다(실측). 그래서 파싱 **전에** 토크나이저로
// 닫히지 않은 블록을 먼저 거부하고, 파싱 **후에** 파서가 포기하고 남긴 `Raw` 조각을
// 토큰으로 다시 본다 — 워크가 보지 못한 CSS 는 검사되지 않은 CSS 다.
//
// ‼️ "URL 파서를 쓴다" 만으로는 부족하다. base 하나로 판정하면 `url(https:evil.com/x)`
// 가 빠져나간다: 값의 scheme 이 base 의 scheme 과 같으면 WHATWG 파서는 그것을 상대
// 참조로 읽고 base 를 따라 움직인다. 앱의 실제 base 는 `tauri:`·`http:` 라 브라우저는
// 같은 값을 절대 URL 로 읽는다. `isRemoteUrl` 의 두 쌍이 그래서 있다.

import * as csstree from "css-tree";

import { ThemeCssError } from "./errors";

// 인자로 받은 맨 `<string>` 이 곧 자원의 이름이 되는 함수들. 그 인자는 `Url` 노드가
// 아니라 `String` 노드라서 Url 워크에 잡히지 않는다(실측).
//
// ‼️ 이 집합은 구멍의 모양 자체다 — CSS 가 문자열을 자원 이름으로 받는 함수를 새로 얻을
// 때마다 여기에 더해야 한다. 오늘 아는 것: `image-set()`(Images 4), `image()`(Images 4,
// `<image-src> = <url> | <string>`), `src()`(Values 5), 그리고 `url()` 자신 — 값 자리
// 밖(미디어 특성 값 등)에서는 css-tree 가 `Url` 이 아니라 `Function:url` 을 준다(실측).
//
// ‼️ `assertNoRemoteReferences` 는 이 집합을 **같이 쓴다**. 즉 출력 스캔은 여기 빠진
// 이름을 메워 주지 않는다 — 메워 주는 것은 AST 노드 **모양** 의 열거 실수뿐이다.
const URL_BEARING_FUNCTIONS: ReadonlySet<string> = new Set([
  "-webkit-image-set",
  "image",
  "image-set",
  "src",
  "url",
]);

// 상대 URL 을 해석해 볼 가짜 출처. 쌍 안에서는 host 만 다르고, 두 쌍 사이에서는
// scheme 이 다르다 — `isRemoteUrl` 이 두 쌍을 모두 쓰는 이유가 그 차이다.
const PROBE_BASES = ["https://a.invalid/theme/", "https://b.invalid/theme/"];
const PROBE_BASES_OPAQUE = [
  "baram-a://a.invalid/theme/",
  "baram-b://b.invalid/theme/",
];

// 자원의 이름을 실어 나를 수 있는 토큰. `Raw` 안에서 이 중 하나라도 보이면 그 조각은
// 검사되지 않은 참조를 숨기고 있을 수 있다. `Function` 까지 넣는 이유는 `url( "x" )`
// 처럼 공백이 끼면 url-token 이 아니라 function-token 으로 쪼개지기 때문이다.
const RESOURCE_NAMING_TOKENS: ReadonlySet<number> = new Set([
  csstree.tokenTypes.BadString,
  csstree.tokenTypes.BadUrl,
  csstree.tokenTypes.Function,
  csstree.tokenTypes.String,
  csstree.tokenTypes.Url,
]);

// computed-value 시점에 값이 정해지는 CSS 치환 함수. 설치 시점에는 무엇이 될지 증명할
// 수 없으므로, 자원 이름을 받는 함수 안에서는 거부한다.
const SUBSTITUTION_FUNCTIONS: ReadonlySet<string> = new Set([
  "attr",
  "env",
  "var",
]);

// 입력이 끝까지 닫혀 있는지 토크나이저에게 묻는다. 직접 중괄호를 세지 않는 이유는
// 문자열·주석·`url()` 안의 중괄호를 구분해야 하기 때문이고, 그 구분은 토크나이저가
// 이미 한다 — `a{content:'}'}` 는 닫혀 있고 `a{content:"hi}` 는 닫혀 있지 않다.
function assertWellFormed(css: string, stage: string): void {
  const stream = new csstree.TokenStream(css, csstree.tokenize);
  stream.forEachToken((type, start, _end, index) => {
    const name = csstree.tokenNames[type];
    if (
      type === csstree.tokenTypes.BadString ||
      type === csstree.tokenTypes.BadUrl
    ) {
      throw new ThemeCssError("parseFailed", `${stage} ${name} at ${start}`);
    }
    // css-tree 자신의 짝 찾기. 짝이 없으면 -1 이고, 그건 EOF 까지 열려 있었다는 뜻이다.
    const unpaired =
      (stream.isBlockOpenerTokenType(type) ||
        stream.isBlockCloserTokenType(type)) &&
      stream.getBlockTokenPairIndex(index) === -1;
    if (unpaired) {
      throw new ThemeCssError(
        "parseFailed",
        `${stage} unpaired ${name} at ${start}`,
      );
    }
  });
}

// 마지막 관문 — 우리가 내보낼 바이트를 토큰 수준에서 다시 훑는다. 나가는 CSS 안의 모든
// `url()` 토큰과, `URL_BEARING_FUNCTIONS` 안에 있는(이름은 `cssName` 으로 디코드한 뒤
// 비교하는) 함수 **안쪽 어디든**의 문자열을, 파서의 디코더로 풀어서 다시 판정한다.
//
// 무엇을 막아 주는지 정확히: **AST 노드 모양의 열거 실수**다. 위의 워크는 `Url` 노드와
// `String` 노드의 바로 위 함수만 보는데, 실제로 `@media (scripting:url("…"))` 에서
// css-tree 가 `Url` 이 아니라 `Function:url` 을 주어 한 번 새어 나갔고,
// `image-set(local("https://…"))` 처럼 한 겹 더 감싸면 지금도 워크는 보지 못한다.
// 토큰 범위로 보는 이 스캔은 그 두 부류를 다 잡는다(실측: 이 관문만 빼면 말뭉치
// 539개 중 33개가 열린다).
//
// ‼️ 무엇을 막아 주지 **않는지**도 정확히: 이름 집합은 워크와 **공유**한다. 그래서
// `URL_BEARING_FUNCTIONS` 에 빠진 함수는 이 스캔도 놓친다. 그건 다른 층이 아니라
// 그 집합을 고쳐야 막힌다.
function assertNoRemoteReferences(css: string): void {
  const stream = new csstree.TokenStream(css, csstree.tokenize);
  // 자원 이름을 받는 함수가 열려 있는 동안의 토큰 인덱스 상한. 함수는 제대로 중첩되므로
  // 가장 바깥의 닫힘 위치 하나만 들고 있으면 된다.
  let bearingUntil = -1;
  stream.forEachToken((type, start, end, index) => {
    const text = css.slice(start, end);
    if (type === csstree.tokenTypes.Function) {
      if (URL_BEARING_FUNCTIONS.has(cssName(css.slice(start, end - 1)))) {
        const close = stream.getBlockTokenPairIndex(index);
        bearingUntil = Math.max(
          bearingUntil,
          close === -1 ? stream.tokenCount : close,
        );
      }
      return;
    }
    const value =
      type === csstree.tokenTypes.Url
        ? csstree.url.decode(text)
        : type === csstree.tokenTypes.String && index < bearingUntil
          ? csstree.string.decode(text)
          : null;
    if (value !== null && isRemoteUrl(value)) {
      throw new ThemeCssError("absoluteUrl", `output ${text.slice(0, 80)}`);
    }
  });
}

// at-rule 이름과 함수 이름을 비교 가능한 형태로. **반드시 이것을 거쳐서 비교한다** —
// css-tree 는 이름을 원문 그대로 준다(`@\69 mport` 는 AST 에서도 `\69 mport` 다).
// 디코드하지 않고 비교하면 `@\69 mport "x.css"` 와 `\69 mage-set("https://…")` 가
// 그대로 통과한다 — 실측했고, `\68 ttps:` 와 정확히 같은 부류의 함정이다.
function cssName(raw: string): string {
  return csstree.ident.decode(raw).toLowerCase();
}

// 이 참조가 테마 패키지 밖을 가리키는가. 판정은 WHATWG URL 파서가 한다 —
// `link-href.ts` 와 같은 이유로: 브라우저가 실제로 돌리는 파서만이 탭·개행·앞뒤
// 공백을 지우고 scheme 을 소문자로 접은 뒤의 의미를 안다.
//
// 규칙은 "base 를 바꿔도 안 움직이면 우리 밖" 이고, **쌍을 둘 쓴다.** 한 쌍만으로는
// 값의 scheme 이 그 쌍의 scheme 과 같을 때 뚫린다 — `https:evil.com/x` 는 `https:`
// base 에서는 상대 참조로 움직이지만 `baram-a:` base 에서는 절대 URL 로 고정된다.
// 반대로 `\\evil.com\x` 는 special scheme(`https:`) 에서만 authority 로 바뀌므로
// `https:` 쌍이 잡는다. 둘 중 한 쌍이라도 고정되면 거부한다.
function isRemoteUrl(value: string): boolean {
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

// `Raw` 값 안에서 자원을 가리킬 수 있는 첫 토큰의 이름. 없으면 null. 여기서도
// 토크나이저에게 묻는다 — 문자열 검사로 판정하면 이스케이프에 뚫린다.
function resourceNamingToken(value: string): null | string {
  let found: null | string = null;
  csstree.tokenize(value, (type) => {
    if (found === null && RESOURCE_NAMING_TOKENS.has(type)) {
      found = csstree.tokenNames[type];
    }
  });
  return found;
}

// 로그용 위치 꼬리표. `positions: true` 로 파싱했으므로 거의 항상 붙는다.
function where(node: csstree.CssNode): string {
  return node.loc ? ` (${node.loc.start.line}:${node.loc.start.column})` : "";
}

/**
 * 테마가 실어 보낸 CSS 를 DOM 에 닿아도 되는 형태로 바꾼다.
 *
 * 통과하면 `@layer baram-theme { … }` 로 감싼 CSS 를 돌려주고, 통과하지 못하면
 * `ThemeCssError` 를 던진다 — 반환값으로 실패를 알리지 않는 이유는 호출자가
 * 실수로 원본을 주입할 여지를 남기지 않기 위해서다.
 */
export function sanitizeThemeCss(css: string): string {
  assertWellFormed(css, "input");

  // 1차 — 구조만 본다. 커스텀 속성 값은 **파싱하지 않는다**: CSS Variables 는 값 자리에
  // 거의 아무 토큰열이나 허용하는데 그것을 값 문법으로 읽으면 합법한 테마가 문법 오류로
  // 거부된다(`--raw:{a:b}`·`--x:https://e.com/x.png` 이 실제로 그랬다). 그래서 여기서
  // 나는 오류는 커스텀 속성 **밖**의 진짜 구조 문제뿐이다.
  try {
    csstree.parse(css, {
      onParseError: (error) => {
        throw error;
      },
      parseCustomProperty: false,
    });
  } catch (error) {
    throw new ThemeCssError("parseFailed", String(error));
  }

  // 2차 — 검사하고 내보낼 AST. 이쪽은 커스텀 속성 값도 파싱해야 `--evil:url(https://…)`
  // 가 Url 노드로 보인다(끄면 통째로 Raw 가 되어 워크에 안 잡힌다, 실측). 여기서 나는
  // 오류는 1차가 이미 걸렀거나 커스텀 속성 값 안의 것이고, 후자는 아래 Raw 관문이 토큰으로
  // 다시 본다 — 그래서 여기서는 `onParseError` 로 막지 않는다.
  const ast = csstree.parse(css, {
    parseCustomProperty: true,
    positions: true,
  });

  csstree.walk(ast, function (node) {
    switch (node.type) {
      case "Atrule":
        if (cssName(node.name) === "import") {
          throw new ThemeCssError("importNotAllowed", `@import${where(node)}`);
        }
        break;
      case "Declaration":
        // §359: layered `!important` 는 unlayered `!important` 를 이긴다(Cascade 5).
        // 레이어 래핑만으로는 보안 표면을 못 지키므로 여기서 제거한다.
        node.important = false;
        break;
      case "Function":
        // 자원 이름을 받는 함수 안의 치환 함수. `image-set(var(--x) 1x)` 는 `--x` 가
        // 무엇이든 그 자리에서 fetch 대상이 되는데, 그 값은 computed-value 시점에야
        // 정해진다 — 설치 시점에 증명할 수 없는 것은 통과시키지 않는다.
        if (
          this.function !== null &&
          URL_BEARING_FUNCTIONS.has(cssName(this.function.name)) &&
          SUBSTITUTION_FUNCTIONS.has(cssName(node.name))
        ) {
          throw new ThemeCssError(
            "absoluteUrl",
            `${this.function.name}(${node.name}())${where(node)}`,
          );
        }
        break;
      case "Raw": {
        // 파서가 읽기를 포기한 조각이다. 그 안은 다른 워크가 들여다보지 못했으므로,
        // 자원의 이름을 실을 수 있는 토큰이 하나라도 있으면 통과시키지 않는다.
        const token = resourceNamingToken(node.value);
        if (token !== null) {
          throw new ThemeCssError(
            "parseFailed",
            `unparsed ${token}${where(node)}: ${node.value.slice(0, 80)}`,
          );
        }
        break;
      }
      case "String":
        if (
          this.function !== null &&
          URL_BEARING_FUNCTIONS.has(cssName(this.function.name)) &&
          isRemoteUrl(node.value)
        ) {
          throw new ThemeCssError(
            "absoluteUrl",
            `${node.value.slice(0, 80)}${where(node)}`,
          );
        }
        break;
      case "Url":
        // css-tree 가 이스케이프를 해석하고 따옴표·공백을 벗긴 뒤의 값을 준다 —
        // 그래서 `url(\68 ttps://…)` 가 여기서 `https://…` 다(실측).
        //
        // ‼️ **보안 판정으로는** 이 case 와 아래 `String` case 가 중복이다: 둘을 빼도
        // 말뭉치 539개의 통과/거부가 하나도 바뀌지 않는다(실측) — `assertNoRemoteReferences`
        // 가 같은 것을 출력에서 다시 잡는다. 그러니 "여기가 막고 있다"고 읽으면 안 된다.
        //
        // 이 case 가 **혼자** 주는 것은 진단이다. 워크는 AST 노드를 보므로 `loc` 이 있고
        // detail 에 `(줄:칸)` 이 붙는다. 지우면 출력 스캔이 위치 없는 `output …` 만 남긴다.
        // 테스트 "워크가 먼저 답하고 위치를 준다"가 그 차이를 고정한다 — 지우면 빨개진다.
        if (isRemoteUrl(node.value)) {
          throw new ThemeCssError(
            "absoluteUrl",
            `${node.value.slice(0, 80)}${where(node)}`,
          );
        }
        break;
    }
  });

  const sanitized = `@layer baram-theme {\n${csstree.generate(ast)}\n}\n`;
  // 우리가 내보내는 것도 우리 기준을 통과해야 한다. 짝이 안 맞는 `}` 하나면 그 뒤의
  // 테마 CSS 가 `@layer baram-theme {` 밖으로 빠져나가 레이어 우선순위를 통째로 무시한다.
  //
  // ‼️ 이것은 **어떤 테스트도 고정하지 못하는** 순수 이중화다. 빼도 말뭉치 539개의 판정이
  // 바뀌지 않고(실측), 진단도 달라지지 않는다. 여기서 걸리려면 입력이 닫혀 있는데 css-tree 의
  // `generate` 가 균형을 깨야 하는데, 균형 잡힌 입력 348개를 generate 까지 돌려 그런 출력이
  // 나오는지 따로 찾아봤고 0건이었다. 즉 css-tree 의 버그가 생겨야 발화한다 — 지우면 아무
  // 테스트도 빨개지지 않으니, 이 주석이 유일한 표시다.
  assertWellFormed(sanitized, "output");
  assertNoRemoteReferences(sanitized);
  return sanitized;
}
