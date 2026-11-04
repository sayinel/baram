// §358 테마 CSS 위생 — 설치 시점에 한 번 돌고, 그 결과가 저장되어 주입된다.
//
// 원격 자산을 막는 이유는 CSP가 막아 주지 않기 때문이다: `img-src` 에 `https:` 가
// 열려 있고(문서 안 원격 이미지가 정당한 기능이다) 전역으로 닫을 수 없다. 그래서
// 여기가 유일한 관문이다. `font-src`·`style-src` 는 CSP가 이미 닫아 두었지만,
// 그 사실에 기대지 않고 여기서도 거부한다 — CSP 는 언제든 완화될 수 있다.
//
// ‼️ "URL 파서를 쓴다" 만으로는 부족하다. base 하나로 판정하면 `url(https:evil.com/x)`
// 가 빠져나간다: 값의 scheme 이 base 의 scheme 과 같으면 WHATWG 파서는 그것을 상대
// 참조로 읽고 base 를 따라 움직인다. 앱의 실제 base 는 `tauri:`·`http:` 라 브라우저는
// 같은 값을 절대 URL 로 읽는다. `isRemoteUrl` 의 두 쌍이 그래서 있다.

import * as csstree from "css-tree";

import { sanitizeCssWith } from "./css-pipeline";
import { cssName, isRemoteUrl, where } from "./css-refs";
import { ThemeCssError } from "./errors";

/**
 * 테마 CSS 가 들어가는 cascade layer 의 이름. 감싸는 쪽이 여기 있으므로 이름의 집도
 * 여기다 — 로드 시점에 "전부 이 레이어 안인가" 를 다시 보는 `verify.ts` 가 이것을
 * 읽는다. 두 곳에 같은 문자열을 적으면 한쪽만 고친 날 테마 CSS 가 통째로 거부된다.
 */
export const THEME_LAYER_NAME = "baram-theme";

// `raw`(함수 토큰에서 닫는 괄호까지)의 여는 괄호 뒤 첫 공백이 아닌 토큰이 문자열인가.
// 브라우저는 이름이 `url` 인 토큰을 이때만 함수 토큰으로 만든다(CSS Syntax, consume an
// ident-like token). 주석은 공백이 아니므로 건너뛰지 않는다.
function opensWithString(raw: string): boolean {
  let opens = false;
  let seenFunction = false;
  let decided = false;
  csstree.tokenize(raw, (type) => {
    if (decided) return;
    if (!seenFunction) {
      seenFunction = true;
      return;
    }
    if (type === csstree.tokenTypes.WhiteSpace) return;
    decided = true;
    opens = type === csstree.tokenTypes.String;
  });
  return opens;
}

/**
 * 테마가 실어 보낸 CSS 를 DOM 에 닿아도 되는 형태로 바꾼다.
 *
 * 통과하면 `@layer baram-theme { … }` 로 감싼 CSS 를 돌려주고, 통과하지 못하면
 * `ThemeCssError` 를 던진다 — 반환값으로 실패를 알리지 않는 이유는 호출자가
 * 실수로 원본을 주입할 여지를 남기지 않기 위해서다.
 *
 * §394 — 단계는 `css-pipeline.ts` 가 플러그인 CSS 와 함께 갖고, 여기 남은 것은 테마의 정책이다:
 * 패키지 상대 참조는 통과(`isRemoteUrl`), `@import` 거부, 이스케이프로 쓴 `url` 함수 토큰의 규칙,
 * 레이어 감싸기.
 */
export function sanitizeThemeCss(css: string): string {
  return sanitizeCssWith(
    css,
    {
      node(node) {
        if (node.type === "Atrule" && cssName(node.name) === "import") {
          throw new ThemeCssError("importNotAllowed", `@import${where(node)}`);
        }
      },
      refuse(code, detail): never {
        throw new ThemeCssError(code, detail);
      },
      resource(value, detail) {
        if (isRemoteUrl(value)) throw new ThemeCssError("absoluteUrl", detail);
      },
      // §394 spec 0073 D9 — the function-token visits of the output scan
      // (`assertNoRemoteReferences` in `css-pipeline.ts`). Two rules, by what css-tree and the
      // browser agree on:
      //  - decoded name `url`: refused unless the first non-whitespace token after `(` is a string
      //    (`u\72 l("local.png")` stays; the string is judged by `resource` above). Otherwise the
      //    browser's view of the argument differs from css-tree's, so no value read from it can be
      //    trusted — `u\72l(a");}b{background:url(https://evil/x)}c{x:")}` is one string to css-tree
      //    and a live rule `b` to Chrome.
      //  - `image-set` and the other names: both parsers make a function token, so the argument is
      //    judged as a url token's value would be. `argument` is `null` when it holds a string, a url
      //    or a function, which `resource` above or this scan's next visit judges (a bad string or
      //    bad url was refused by `assertWellFormed`).
      // `verifyStoredThemeCss` (`hasUrlSpelledAsFunction`) still refuses any `url` function token at
      // install and load; this makes sanitize refuse these under their own code.
      urlFunction(name, argument, raw) {
        if (
          (name === "url" && !opensWithString(raw)) ||
          (argument !== null && isRemoteUrl(argument))
        ) {
          throw new ThemeCssError("absoluteUrl", `output ${raw.slice(0, 80)}`);
        }
      },
    },
    (generated) => `@layer ${THEME_LAYER_NAME} {\n${generated}\n}\n`,
  );
}
