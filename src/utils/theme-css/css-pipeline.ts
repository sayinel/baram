// §358 · §394 The parser pipeline both CSS sanitizers run: the theme sanitizer (`sanitize.ts`,
// §358) and the plugin output sanitizer (`plugins/rendered/sanitize-css.ts`, §394, spec 0073 D9).
// What differs between them is POLICY — which resource names pass, which at-rules and selectors
// exist, what the output is wrapped in — and each brings it as a `CssPipelinePolicy`. What is
// shared is everything that decides what the parser saw: the closed-block check before parsing,
// the substitution scan, the first parse's error refusal, the walk over the second parse
// (`!important` removed, a `Raw` that names a resource refused) and the token re-scan of the bytes
// that go out. A second copy of that sequence is how one sanitizer would come to miss a step the
// other has.
//
// ‼️ 판정은 전부 파서가 준 것으로 한다. 문자열·정규식 검사는 CSS 이스케이프
// (`url(\68 ttp://…)`)와 대소문자·공백 변형에 뚫린다 — 이 리포는 링크 scheme
// 판정에서 같은 이유로 regex 재구현을 금지하고 있다(`utils/link-href.ts`).
//
// ‼️ 관대한 파서는 열린 문이다. css-tree 는 `a{color:red` 를 조용히 닫고 성공을
// 돌려주며 `onParseError` 도 부르지 않는다(실측). 그래서 파싱 **전에** 토크나이저로
// 닫히지 않은 블록을 먼저 거부하고, 파싱 **후에** 파서가 포기하고 남긴 `Raw` 조각을
// 토큰으로 다시 본다 — 워크가 보지 못한 CSS 는 검사되지 않은 CSS 다.

import type { CssNode, WalkContext } from "css-tree";

import * as csstree from "css-tree";

import {
  cssName,
  forEachResourceName,
  forEachUrlBearingFunction,
  RESOURCE_NAMING_TOKENS,
  substitutionInsideResourceName,
  URL_BEARING_FUNCTIONS,
  where,
} from "./css-refs";

/** The refusals the pipeline itself raises; each sanitizer maps them onto its own error. */
export type CssPipelineRefusal = "parseFailed" | "substitutionNotAllowed";

/** What one sanitizer decides on top of the shared steps. Every hook refuses by throwing. */
export interface CssPipelinePolicy {
  /**
   * Every node of the second parse, before the shared checks on it. `context` is css-tree's walk
   * context — `context.selector` is non-null inside a selector, `context.atrule` inside an at-rule.
   */
  node(node: CssNode, context: WalkContext): void;
  /** Throw this sanitizer's own error for a refusal the pipeline raised. */
  refuse(code: CssPipelineRefusal, detail: string): never;
  /**
   * A resource name — already decoded — that the walk (a `Url`, a `String` inside a URL-bearing
   * function) or the output scan met. `detail` locates it: `(line:column)` from the walk,
   * `output …` from the scan.
   */
  resource(value: string, detail: string): void;
  /**
   * A URL-bearing function token in the output, as `forEachUrlBearingFunction` visits it: `name`
   * decoded, `argument` read the way a url token's value is or `null`, `raw` through the closing
   * parenthesis. A `url` visit is judged from `raw`, not from `argument` — see there.
   */
  urlFunction(name: string, argument: null | string, raw: string): void;
}

// 입력이 끝까지 닫혀 있는지 토크나이저에게 묻는다. 직접 중괄호를 세지 않는 이유는
// 문자열·주석·`url()` 안의 중괄호를 구분해야 하기 때문이고, 그 구분은 토크나이저가
// 이미 한다 — `a{content:'}'}` 는 닫혀 있고 `a{content:"hi}` 는 닫혀 있지 않다.
function assertWellFormed(
  css: string,
  stage: string,
  policy: CssPipelinePolicy,
): void {
  const stream = new csstree.TokenStream(css, csstree.tokenize);
  stream.forEachToken((type, start, _end, index) => {
    const name = csstree.tokenNames[type];
    if (
      type === csstree.tokenTypes.BadString ||
      type === csstree.tokenTypes.BadUrl
    ) {
      policy.refuse("parseFailed", `${stage} ${name} at ${start}`);
    }
    // css-tree 자신의 짝 찾기. 짝이 없으면 -1 이고, 그건 EOF 까지 열려 있었다는 뜻이다.
    const unpaired =
      (stream.isBlockOpenerTokenType(type) ||
        stream.isBlockCloserTokenType(type)) &&
      stream.getBlockTokenPairIndex(index) === -1;
    if (unpaired) {
      policy.refuse("parseFailed", `${stage} unpaired ${name} at ${start}`);
    }
  });
}

// 마지막 관문 — 우리가 내보낼 바이트를 토큰 수준에서 다시 훑는다. 스캔이 둘이다:
// `forEachResourceName` 이 `url` 토큰과 문자열을 정하고, `forEachUrlBearingFunction` 이
// 함수 토큰을 정한다. 여기서는 그 값에 정책만 건다.
//
// 무엇을 막아 주는지 정확히: **AST 노드 모양의 열거 실수**다. 위의 워크는 `Url` 노드와
// `String` 노드의 바로 위 함수만 보는데, 실제로 `@media (scripting:url("…"))` 에서
// css-tree 가 `Url` 이 아니라 `Function:url` 을 주어 한 번 새어 나갔고,
// `image-set(local("https://…"))` 처럼 한 겹 더 감싸면 지금도 워크는 보지 못한다.
// 토큰 범위로 보는 이 스캔은 그 두 부류를 다 잡는다 — 이 관문만 빼면 말뭉치 중
// **33개가 열린다**(실측). 그 측정의 집은 `dev/impl-notes/0050-theme-css-ablation-record.md`
// 이다: 무엇을 절제했고 어떤 입력이 새는지가 거기 있다. ‼️ 그 기록의 §2 가 말하듯
// 인용되던 말뭉치 크기(539)는 문서화된 구성(525)과 맞지 않고 539 가 무엇을 세는지
// 적힌 곳이 없다 — 여는 33개는 실측이지만 분모는 재현 가능한 이름을 아직 못 가졌다.
//
// ‼️ 무엇을 막아 주지 **않는지**도 정확히: 이름 집합은 워크와 **공유**한다. 그래서
// `URL_BEARING_FUNCTIONS` 에 빠진 함수는 이 스캔도 놓친다. 그건 다른 층이 아니라
// 그 집합을 고쳐야 막힌다.
function assertNoRemoteReferences(
  css: string,
  policy: CssPipelinePolicy,
): void {
  forEachResourceName(css, (value, raw) => {
    policy.resource(value, `output ${raw.slice(0, 80)}`);
  });
  // §394 spec 0073 D9 — the function-token half. A name escaped into `url` (`u\72l(//evil/x)`) is
  // a function token to css-tree and, unless a string follows `(`, a url or bad-url token to the
  // browser, so the scan above sees nothing there. What a visit means is policy: the theme's two
  // rules sit on its `urlFunction` in `sanitizeThemeCss`, and plugin CSS refuses every visit.
  forEachUrlBearingFunction(css, (name, argument, raw) => {
    policy.urlFunction(name, argument, raw);
  });
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

/**
 * Run `css` through the shared pipeline under `policy`, and return the generated CSS as `wrap`
 * shapes it. Every refusal throws — a sanitizer never returns its input unchecked.
 */
export function sanitizeCssWith(
  css: string,
  policy: CssPipelinePolicy,
  wrap: (generated: string) => string,
): string {
  assertWellFormed(css, "input", policy);

  // 자원 이름을 받는 함수 안의 치환 함수. `image-set(var(--x) 1x)` 는 `--x` 가 무엇이든
  // 그 자리에서 fetch 대상이 되는데, 그 값은 computed-value 시점에야 정해진다 — 위생을
  // 도는 시점(테마는 설치, §394 플러그인 CSS 는 렌더)에 증명할 수 없는 것은 통과시키지 않는다.
  //
  // ‼️ 코드는 `absoluteUrl` 이 아니다. `--x` 가 순전히 로컬이어도 거부하므로 "절대 URL 을
  // 썼다" 는 제작자에게 **거짓 원인**이다 — 고칠 곳을 엉뚱한 데로 보낸다. 거부 사유가
  // "증명할 수 없는 치환" 인 것이 실제 사실이다.
  //
  // ‼️ AST 워크의 `case "Function"` 에서 이 토큰 스캔으로 옮겼다(0090 최종 리뷰, M4).
  // 워크는 **바로 위** 함수만 봤고(`this.function`) `Raw` 안을 보지 못했다. 같은 판정을
  // verify 도 써야 했으므로 `css-refs.ts` 로 옮겼고, 옮기면서 깊이가 문자열 규칙과
  // 같아졌다 — 그쪽 함수의 주석이 근거를 갖고 있다. 위치 꼬리표(`where`)를 잃는 대신
  // 어느 두 함수가 겹쳤는지를 그대로 싣는다.
  const substitution = substitutionInsideResourceName(css);
  if (substitution !== null) {
    policy.refuse("substitutionNotAllowed", substitution);
  }

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
    policy.refuse("parseFailed", String(error));
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
    policy.node(node, this);
    switch (node.type) {
      case "Declaration":
        // §359: layered `!important` 는 unlayered `!important` 를 이긴다(Cascade 5).
        // 레이어 래핑만으로는 보안 표면을 못 지키므로 여기서 제거한다.
        node.important = false;
        break;
      case "Raw": {
        // 파서가 읽기를 포기한 조각이다. 그 안은 다른 워크가 들여다보지 못했으므로,
        // 자원의 이름을 실을 수 있는 토큰이 하나라도 있으면 통과시키지 않는다.
        const token = resourceNamingToken(node.value);
        if (token !== null) {
          policy.refuse(
            "parseFailed",
            `unparsed ${token}${where(node)}: ${node.value.slice(0, 80)}`,
          );
        }
        break;
      }
      case "String":
        if (
          this.function !== null &&
          URL_BEARING_FUNCTIONS.has(cssName(this.function.name))
        ) {
          policy.resource(
            node.value,
            `${node.value.slice(0, 80)}${where(node)}`,
          );
        }
        break;
      case "Url":
        // css-tree 가 이스케이프를 해석하고 따옴표·공백을 벗긴 뒤의 값을 준다 —
        // 그래서 `url(\68 ttps://…)` 가 여기서 `https://…` 다(실측).
        //
        // ‼️ **보안 판정으로는** 이 case 와 위 `String` case 가 중복이다: 둘을 빼도
        // 말뭉치의 통과/거부가 하나도 바뀌지 않는다(실측 — `dev/impl-notes/0050-theme-css-ablation-record.md`)
        // — `assertNoRemoteReferences` 가 같은 것을 출력에서 다시 잡는다. 그러니
        // "여기가 막고 있다"고 읽으면 안 된다.
        //
        // 이 case 가 **혼자** 주는 것은 진단이다. 워크는 AST 노드를 보므로 `loc` 이 있고
        // detail 에 `(줄:칸)` 이 붙는다. 지우면 출력 스캔이 위치 없는 `output …` 만 남긴다.
        // 테스트 "워크가 먼저 답하고 위치를 준다"가 그 차이를 고정한다 — 지우면 빨개진다.
        policy.resource(node.value, `${node.value.slice(0, 80)}${where(node)}`);
        break;
    }
  });

  const out = wrap(csstree.generate(ast));
  // 우리가 내보내는 것도 우리 기준을 통과해야 한다. 짝이 안 맞는 `}` 하나면 그 뒤의
  // 테마 CSS 가 `@layer baram-theme {` 밖으로 빠져나가 레이어 우선순위를 통째로 무시한다.
  //
  // ‼️ 아래 **두 줄 중 첫 줄**(`assertWellFormed`)에 대한 말이다. 둘째 줄은 정반대다 —
  // `assertNoRemoteReferences` 는 빼면 33개가 열린다(위 함수 머리말).
  //
  // 사실: 이 관문은 **어떤 테스트도 고정하지 못한다.** 빼도 말뭉치의 판정이 바뀌지 않고
  // (실측), 진단도 달라지지 않는다. 여기서 걸리려면 입력이 닫혀 있는데 css-tree 의
  // `generate` 가 균형을 깨야 하는데, 균형 잡힌 입력 348개를 generate 까지 돌려 그런
  // 출력이 나오는지 따로 찾아봤고 0건이었다. 즉 css-tree 의 버그가 생겨야 발화한다.
  //
  // ‼️ 그리고 그 사실은 **삭제 허가가 아니다.** "빼도 아무것도 안 바뀐다" 는 불필요함의
  // 증명이 아니라 그 말뭉치의 **커버리지 측정**이다. 이 브랜치에 전례가 있다 — 재리뷰가
  // 210입력으로 절제해 "변화 0건" 을 얻고 어떤 관문을 불필요하다고 결론냈는데, 더 큰
  // 말뭉치로 다시 재니 33개가 열렸다. 게다가 여기 인용하던 분모(539)는 기록된 구성(525)과
  // 맞지 않고 무엇을 세는지 적힌 곳이 없어, 이 측정은 아직 재현할 수 없다.
  // 근거·전례·미해결 숫자 전부: `dev/impl-notes/0050-theme-css-ablation-record.md`.
  // 지우려면 먼저 **이름 붙은 재현 가능한 말뭉치**를 만들고 거기서 다시 재라.
  assertWellFormed(out, "output", policy);
  assertNoRemoteReferences(out, policy);
  return out;
}
