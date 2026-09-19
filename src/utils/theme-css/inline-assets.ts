// §358 테마가 동봉한 자산을 `data:` URI 로 싣는다 — 설치 시점에 한 번, sanitize 다음.
//
// ‼️ **세 단계의 URL 규칙은 서로 다르다.** 같다고 읽으면 자산을 가진 테마가 전부 거부된다.
//   sanitize  : 저자가 쓴 CSS       → 패키지 상대 경로만. `data:` 도 거부한다(손으로 쓴
//               `data:` 는 아래 자산 상한을 우회한다)
//   inline    : 이 파일             → 그 상대 경로를 읽어 `data:` 로 **바꾼다**
//   verify    : 저장된 CSS          → `data:` 만. 그 외 어떤 URL 도 거부
//
// ‼️ 해석할 수 없는 참조는 "거부" 이지 "그대로 통과" 가 아니다. 통과시키면 `data:` 아닌
// URL 을 물고 저장되고, verify 가 로드 때 거부한다 — 실패가 두 단계 늦게, 원인에서 먼
// 곳에서 드러난다. 없는 파일·패키지 밖 경로·루트 절대 경로는 전부 여기서 던진다.
//
// 인라인이 끝나면 서빙되는 CSS 에 `data:` 외의 URL 이 **존재하지 않는다** — "원격 없음"
// 이 검증이 아니라 구조가 된다. 부수 효과로 `assetProtocol.scope` 확장이 불필요해진다:
// 테마는 `~/.baram/themes` 에 설치되어 그 범위 밖이고, 범위를 주려면
// `no_new_asset_scope_grant_outside_the_allowlist` 가 막는 자리에 새 호출부가 필요하다.

import * as csstree from "css-tree";

import { basename, normalizePath } from "../path-utils";
import {
  cssName,
  forEachResourceName,
  isDataUrl,
  isRemoteUrl,
  NON_RESOURCE_ARGUMENT_FUNCTIONS,
  URL_BEARING_FUNCTIONS,
  where,
} from "./css-refs";
import { ThemeCssError } from "./errors";

// 확장자 → media type. **고정 표다.** 표에 없으면 거부하고, 확장자에서 media type 을
// 만들어 내지 않는다 — 만들어 내면 테마가 임의의 `Content-Type` 을 문서에 심는 통로가
// 된다(`data:text/html`·`data:application/javascript`).
const ASSET_MEDIA_TYPES: ReadonlyMap<string, string> = new Map([
  ["gif", "image/gif"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["otf", "font/otf"],
  ["png", "image/png"],
  // raw(`data:image/svg+xml,<svg …>`)로 싣지 않는다 — 인용·퍼센트 규칙이 까다로워
  // 조용히 깨지고, 깨진 자리는 "아이콘이 안 보인다" 로만 드러난다.
  ["svg", "image/svg+xml"],
  ["ttf", "font/ttf"],
  ["webp", "image/webp"],
  ["woff2", "font/woff2"],
  ["woff", "font/woff"],
]);

/** 동봉 자산의 **누적** 상한. 하나가 아니라 테마 전체가 여기에 들어가야 한다. */
export const MAX_THEME_ASSET_BYTES = 2 * 1024 * 1024;

/**
 * 패키지 상대 경로 하나를 읽는다. 그런 파일이 없으면 `undefined`.
 *
 * ‼️ 구현체는 받은 경로를 **파일 이름 그대로** 다뤄야 한다 — 퍼센트 디코드하거나 URL 로
 * 다시 읽으면 여기서 한 봉쇄 판정이 무의미해진다. 그래서 `%` 가 든 참조는 애초에 거부한다.
 */
export type ThemeAssetReader = (
  relPath: string,
) => Promise<Uint8Array | undefined>;

// 내보낼 바이트의 사후 조건 — 이 모듈이 내세우는 계약("`data:` 외의 URL 이 없다")을
// AST 추론이 아니라 **결과 바이트**에서 다시 확인한다.
//
// ‼️ 아래 워크의 중복이 아니다. 워크는 AST 노드 **모양**을 열거하는데 그 열거는 실제로
// 틀린 적이 있다(`@media (scripting:url("…"))` 에서 css-tree 가 `Url` 이 아니라
// `Function:url` 을 준다). 토큰으로 보는 이 스캔은 그 부류를 잡는다.
//
// ‼️ 무엇을 막아 주지 **않는지**: 이름 집합(`URL_BEARING_FUNCTIONS`)은 워크와 공유한다.
// 거기 빠진 함수는 이 스캔도 놓친다.
function assertOnlyDataUrls(css: string): void {
  forEachResourceName(css, (value, raw, enclosing) => {
    if (enclosing !== null && NON_RESOURCE_ARGUMENT_FUNCTIONS.has(enclosing)) {
      return;
    }
    if (!isDataUrl(value)) {
      throw new ThemeCssError("assetNotFound", `output ${raw.slice(0, 80)}`);
    }
  });
}

// 이 CSS 가 가리키는 자산을 경로별로 모은다. 같은 경로를 두 번 가리켜도 항목은 하나다 —
// 중복해서 인라인하면 저장 크기가 참조 수만큼 불어난다.
//
// 문자열 인자는 `URL_BEARING_FUNCTIONS` 안이면 **중첩 깊이와 무관하게** 자원 이름으로
// 본다. "바로 위 함수" 로만 보면 `image-set(local("assets/x.png"))` 가 인라인되지 않은
// 채 저장되고, verify 가 로드 때 거부한다.
function collectReferences(
  ast: csstree.CssNode,
): Map<string, Array<{ value: string }>> {
  const byPath = new Map<string, Array<{ value: string }>>();
  let bearingDepth = 0;
  const add = (node: csstree.StringNode | csstree.Url): void => {
    const path = packagePathOf(node.value, where(node));
    const nodes = byPath.get(path);
    if (nodes === undefined) byPath.set(path, [node]);
    else nodes.push(node);
  };
  const isBearing = (node: csstree.CssNode): boolean =>
    node.type === "Function" && URL_BEARING_FUNCTIONS.has(cssName(node.name));
  // 타입 주석이 있어야 `this` 가 `WalkContext` 로 붙는다 — `WalkOptions` 는 큰 합집합이라
  // 객체 리터럴만으로는 어느 갈래인지 정해지지 않고, 그러면 `this.function` 이 사라진다.
  const visitor: csstree.WalkOptionsNoVisit = {
    enter(node) {
      if (isBearing(node)) bearingDepth += 1;
      if (node.type === "Url") {
        add(node);
      } else if (
        node.type === "String" &&
        bearingDepth > 0 &&
        !(
          this.function !== null &&
          NON_RESOURCE_ARGUMENT_FUNCTIONS.has(cssName(this.function.name))
        )
      ) {
        add(node);
      }
    },
    leave(node) {
      if (isBearing(node)) bearingDepth -= 1;
    },
  };
  csstree.walk(ast, visitor);
  return byPath;
}

// 바이트를 base64 로. 한 번에 펼치지 않는 이유는 상한이 2 MiB 라서다 — `fromCharCode`
// 에 2백만 인자를 펼치면 스택이 넘친다.
function encodeBase64(bytes: Uint8Array): string {
  const CHUNK = 0x2000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// 확장자로 media type 을 고른다. 표에 없거나 확장자가 없으면 거부다.
function mediaTypeOf(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  // `dot > 0` — `.hidden` 은 확장자가 아니라 이름 전체다.
  const type =
    dot > 0
      ? ASSET_MEDIA_TYPES.get(name.slice(dot + 1).toLowerCase())
      : undefined;
  if (type === undefined) {
    throw new ThemeCssError("assetTypeNotAllowed", path.slice(0, 80));
  }
  return type;
}

// 이 참조가 가리키는 **패키지 상대 경로**. 패키지 안의 파일을 가리키지 않으면 던진다.
function packagePathOf(reference: string, at: string): string {
  // 먼저 URL 파서에게 묻는다. 여기서 걸리는 것(`https://…`·`data:…`·`C:/x`)은 "파일이
  // 없다" 가 아니라 "주소를 썼다" 이고, 코드가 다르면 제작자가 다른 곳을 고친다.
  if (isRemoteUrl(reference)) {
    throw new ThemeCssError("absoluteUrl", `${reference.slice(0, 80)}${at}`);
  }
  // 아래 넷은 **이미 디코드된** 값에 대한 검사다 — css-tree 가 CSS 이스케이프를 풀어
  // 주었으므로 그 아래에 또 다른 인코딩 층이 없다. 각각 파일 이름이 아닌 이유가 다르다:
  //   `#`·`?` — URL 문법이다. 브라우저는 `x.png?v=1` 에서 `x.png` 를 가져간다
  //   `\`     — Windows 의 경로 구분자다. `/` 만 접는 정규화는 이것을 한 조각으로 남긴다
  //   `%`     — 퍼센트 이스케이프. 읽는 쪽이 디코드하는지에 따라 봉쇄 판정이 달라진다
  if (/[#?\\%]/.test(reference)) {
    throw new ThemeCssError(
      "assetPathNotAllowed",
      `${reference.slice(0, 80)}${at}`,
    );
  }
  const path = normalizePath(reference);
  // 정규화가 `..` 를 접고도 남겼다면 패키지 밖이다. 세그먼트로 판정한다 — `startsWith("..")`
  // 하나로는 `..foo.png` 라는 멀쩡한 이름까지 거부한다.
  if (
    path === "" ||
    path.startsWith("/") ||
    path === ".." ||
    path.startsWith("../")
  ) {
    throw new ThemeCssError(
      "assetPathNotAllowed",
      `${reference.slice(0, 80)}${at}`,
    );
  }
  return path;
}

/**
 * 위생 처리된 테마 CSS 안의 패키지 상대 참조를 전부 `data:` URI 로 바꾼다.
 *
 * 입력은 `sanitizeThemeCss` 의 출력이다. 통과하면 `data:` 외의 URL 이 남지 않은 CSS 를
 * 돌려주고, 하나라도 해석할 수 없으면 `ThemeCssError` 를 던진다.
 *
 * ‼️ 두 번 돌릴 수 없다 — 출력의 `data:` 는 절대 URL 이므로 두 번째 호출이
 * `absoluteUrl` 로 거부한다. sanitize 가 손으로 쓴 `data:` 를 거부하는 것과 같은 판정이다.
 */
export async function inlineThemeAssets(
  css: string,
  read: ThemeAssetReader,
): Promise<string> {
  const ast = csstree.parse(css, {
    parseCustomProperty: true,
    positions: true,
  });
  const byPath = collectReferences(ast);
  // 경로 판정은 위에서 전부 끝났다. 읽기는 그 다음이라, 어떤 reader 를 주어도 패키지
  // 밖 경로가 읽히는 일은 없다.
  let total = 0;
  for (const [path, nodes] of byPath) {
    const mediaType = mediaTypeOf(path);
    const bytes = await read(path);
    if (bytes === undefined) {
      throw new ThemeCssError("assetNotFound", path.slice(0, 80));
    }
    total += bytes.byteLength;
    if (total > MAX_THEME_ASSET_BYTES) {
      throw new ThemeCssError("tooLarge", `${path} → ${String(total)}B`);
    }
    const uri = `data:${mediaType};base64,${encodeBase64(bytes)}`;
    for (const node of nodes) node.value = uri;
  }
  // 참조가 없으면 입력 그대로다 — 바꿀 것이 없는데 재생성하면 sanitize 가 검사하고
  // 내보낸 바이트가 이유 없이 달라진다.
  //
  // 우리가 심은 값이 다시 토큰으로 보이는가: `Url` 노드의 generate 는 언제나
  // `url.encode` 를 거쳐 **따옴표 없는** url-token 하나를 낸다(css-tree v3,
  // `lib/syntax/node/Url.js`·`lib/utils/url.js` — 따옴표가 필요한 문자는 `\` 로
  // 이스케이프하지 절대 `url("…")` 로 바꾸지 않는다). 게다가 우리가 심는 값의 알파벳은
  // `data:` + 고정 표의 media type + `;base64,` + base64(`A-Za-z0-9+/=`) 로 닫혀 있어
  // encode 의 이스케이프 대상(제어문자·공백·`\`·따옴표·괄호)을 하나도 포함하지 않는다 —
  // 값이 원문 그대로 나온다. `String` 노드(예: `image-set("…")`)는 따옴표째 나오고,
  // 그쪽이 스캔에 잡히는 것은 `url`·`image-set` 이 `URL_BEARING_FUNCTIONS` 에 있기
  // 때문이다. 즉 두 방출 형태 모두 아래 스캔이 도달한다.
  const inlined = byPath.size === 0 ? css : csstree.generate(ast);
  assertOnlyDataUrls(inlined);
  return inlined;
}
