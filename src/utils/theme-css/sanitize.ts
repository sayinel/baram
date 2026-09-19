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
// 거부한다 — 워크가 보지 못한 CSS 는 검사되지 않은 CSS 다.

import * as csstree from "css-tree";

import { ThemeCssError } from "./errors";

// `image-set()` 은 `url()` 뿐 아니라 맨 `<string>` 도 URL 로 읽는다. 그 인자는 `Url`
// 노드가 아니라 `String` 노드라서 Url 워크에 잡히지 않는다(실측).
const IMAGE_SET_FUNCTIONS: ReadonlySet<string> = new Set([
  "-webkit-image-set",
  "image-set",
]);

// 상대 URL 을 해석해 볼 두 개의 가짜 출처. host 만 다르다 — 아래 `isRemoteUrl` 참조.
const PROBE_BASES = ["https://a.invalid/theme/", "https://b.invalid/theme/"];

// 파서가 포기하고 남긴 `Raw` 조각에 이것들만 들어 있으면 버려도 되는 찌꺼기다.
// 블록 안의 빈 선언(`a{;;color:red}`)이 실제로 이 모양으로 남는다.
const TRIVIAL_RAW_TOKENS: ReadonlySet<number> = new Set([
  csstree.tokenTypes.Comment,
  csstree.tokenTypes.Semicolon,
  csstree.tokenTypes.WhiteSpace,
]);

// 입력이 끝까지 닫혀 있는지 토크나이저에게 묻는다. 직접 중괄호를 세지 않는 이유는
// 문자열·주석·`url()` 안의 중괄호를 구분해야 하기 때문이고, 그 구분은 토크나이저가
// 이미 한다 — `a{content:'}'}` 는 닫혀 있고 `a{content:"hi}` 는 닫혀 있지 않다.
function assertWellFormed(css: string): void {
  const stream = new csstree.TokenStream(css, csstree.tokenize);
  stream.forEachToken((type, start, _end, index) => {
    const name = csstree.tokenNames[type];
    if (
      type === csstree.tokenTypes.BadString ||
      type === csstree.tokenTypes.BadUrl
    ) {
      throw new ThemeCssError("parseFailed", `${name} at ${start}`);
    }
    // css-tree 자신의 짝 찾기. 짝이 없으면 -1 이고, 그건 EOF 까지 열려 있었다는 뜻이다.
    const unpaired =
      (stream.isBlockOpenerTokenType(type) ||
        stream.isBlockCloserTokenType(type)) &&
      stream.getBlockTokenPairIndex(index) === -1;
    if (unpaired) {
      throw new ThemeCssError("parseFailed", `unpaired ${name} at ${start}`);
    }
  });
}

// 이 참조가 테마 패키지 밖을 가리키는가. 판정은 WHATWG URL 파서가 한다 —
// `link-href.ts` 와 같은 이유로: 브라우저가 실제로 돌리는 파서만이 탭·개행·앞뒤
// 공백을 지우고 scheme 을 소문자로 접은 뒤의 의미를 안다. `htt<TAB>ps://e.com` 은
// scheme regex 에는 상대 경로로 보이지만 브라우저에는 `https://e.com` 이다.
//
// 규칙 하나로 끝난다: base 를 바꿔도 같은 곳을 가리키면 우리 밖이다. 상대 경로는
// base 를 따라 움직이고, scheme 이 붙은 것(`https:`·`data:`)과 프로토콜 상대
// (`//host/…`)는 움직이지 않는다. 해석 자체가 실패하면 모르는 형태이므로 거부한다.
function isRemoteUrl(value: string): boolean {
  try {
    const [a, b] = PROBE_BASES.map((base) => new URL(value, base).href);
    return a === b;
  } catch {
    return true;
  }
}

// `Raw` 값이 버려도 되는 찌꺼기인가. 여기서도 토크나이저에게 묻는다 — 문자열 검사로
// 판정하면 `Raw` 안에 숨은 `url(…)` 를 놓친다.
function isTrivialRaw(value: string): boolean {
  let trivial = true;
  csstree.tokenize(value, (type) => {
    if (!TRIVIAL_RAW_TOKENS.has(type)) trivial = false;
  });
  return trivial;
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
  assertWellFormed(css);

  let ast: csstree.CssNode;
  try {
    ast = csstree.parse(css, {
      onParseError: (error) => {
        // 이 throw 는 밖으로 전파된다(실측). 다만 파서가 여기까지 오지 않고
        // 조용히 넘어가는 경우가 많아, 이것만으로는 관문이 되지 못한다.
        throw error;
      },
      // 커스텀 속성 값은 기본값에서 통째로 `Raw` 가 된다 — `--x:url(https://…)` 가
      // Url 워크에 보이지 않는다(실측). 켜야 판정 대상이 된다.
      parseCustomProperty: true,
      // 거부 위치를 로그에 남기려면 loc 이 필요하다.
      positions: true,
    });
  } catch (error) {
    throw new ThemeCssError("parseFailed", String(error));
  }

  csstree.walk(ast, function (node) {
    switch (node.type) {
      case "Atrule":
        if (node.name.toLowerCase() === "import") {
          throw new ThemeCssError("importNotAllowed", `@import${where(node)}`);
        }
        break;
      case "Declaration":
        // §359: layered `!important` 는 unlayered `!important` 를 이긴다(Cascade 5).
        // 레이어 래핑만으로는 보안 표면을 못 지키므로 여기서 제거한다.
        node.important = false;
        break;
      case "Raw":
        // 파서가 읽기를 포기한 조각이다. 그 안은 아래 워크들이 들여다보지 못했으므로
        // 무해한 찌꺼기가 아니면 통과시키지 않는다.
        if (!isTrivialRaw(node.value)) {
          throw new ThemeCssError(
            "parseFailed",
            `unparsed${where(node)}: ${node.value.slice(0, 80)}`,
          );
        }
        break;
      case "String":
        if (
          this.function !== null &&
          IMAGE_SET_FUNCTIONS.has(this.function.name.toLowerCase()) &&
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
        if (isRemoteUrl(node.value)) {
          throw new ThemeCssError(
            "absoluteUrl",
            `${node.value.slice(0, 80)}${where(node)}`,
          );
        }
        break;
    }
  });

  return `@layer baram-theme {\n${csstree.generate(ast)}\n}\n`;
}
