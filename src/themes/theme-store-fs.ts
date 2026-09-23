// §360 테마 파일 접근 — staged 트리와 설치된 트리, 두 쪽 다 여기로만 읽는다 (스펙 0049 §9).
//
// 테마는 `~/.baram/themes/` 에 설치되고 그곳은 `assetProtocol.scope` 밖이다(스펙 §3.2).
// 범위를 주려면 새 `allow_directory` 호출부가 필요한데 그것은
// `no_new_asset_scope_grant_outside_the_allowlist` 가 막는 자리다 — 그래서 파일 접근은
// asset URL 이 아니라 IPC 다. 0089 가 모든 자산을 `data:` 로 인라인해 둔 덕에 **로드
// 시점에는** 읽을 것이 저장 CSS 하나뿐이고, 그 사실이 asset scope 확장을 불필요하게
// 만든다(`inline-assets.ts` 머리주석).
//
// ‼️ 이 파일은 **열거하지 않는다.** 설치된 테마의 목록은 설정 스토어가 들고 있고
// (`tauriStorage` → Rust `config.json`), 디스크를 다시 훑지 않는다. 근거는 플러그인
// 쪽 선례다: `plugin_list_installed` 는 구현돼 있지만 `src/` 에 호출자가 **없고**,
// `plugin-consent.ts` 의 `grantableCapabilities` 주석이 그 이유를 적어 뒀다 — 설치 뒤에
// 디스크의 매니페스트를 다시 읽는 경로를 만드는 순간 "설치 후 매니페스트 편집" 이 살아난다.
// 테마에서는 그것이 카드 이름·버전 위장이고, 동의 기록은 `config.json` 에 있으므로
// 디스크 열거는 그 기록과 짝이 맞지 않는 두 번째 진실이 된다. 자세한 판단은 Task 4 리포트.
//
// ‼️ 그 결과로 **고아 설치**가 가능하다 — Rust 의 commit 과 프런트의 기록 저장 사이에서
// 앱이 죽으면 디렉터리는 남고 기록에는 없다. Task 4(F4)·Task 5 에 이어 Task 6 도
// **고치지 않기로** 했고, 이번 근거는 앞의 둘과 다르다(각각 "Rust 쪽 일이다", "범위 밖"
// 이었다). 이번 근거는 두 가지 실측이다:
//
//  - **고아는 불활성이고 스스로 낫는다.** 아무것도 트리를 열거하지 않으므로 고아를 읽는
//    경로가 없고, 같은 id 를 다시 설치하면 `swap_into_place`(`install.rs`)가 설치 경로
//    **디렉터리 자체**를 갈아 끼우므로 사본이 쌓이는 것이 아니라 회수된다.
//  - **고칠 때의 실패 모양이 더 나쁘다.** 회수 스윕은 "기록에 없는 디렉터리를 지운다"
//    이고, 그 입력은 설정 스토어의 `installedThemes` 다. 하이드레이션이 한 번이라도
//    비어서 돌아오면(읽기 실패·마이그레이션 결함) 그 스윕은 **설치된 테마 전부**를
//    지운다. 조용한 실패를 데이터 손실로 바꾸는 교환이다.
//
// 할 만해지는 조건: 기록을 commit 이 **Rust 쪽에** 함께 쓰는 것(§331 의
// `approved-roots.json` 과 같은 모양). 그러면 트리가 자기를 설명하므로 회수의 입력이
// 웹뷰의 목록이 아니라 Rust 자신의 기록이 되고, 위 두 번째 위험이 사라진다. 그것은
// "기록이 어디 사는가" 의 재설계이므로 0090 의 범위가 아니다.
import type { ThemeMode } from "../types/theme";
import type { ThemeAssetReader } from "../utils/theme-css/inline-assets";

import { themeReadStoredCss, themeStageRead } from "../ipc/theme";
import { logger } from "../utils/logger";
import { ThemeCssError } from "../utils/theme-css/errors";
import { verifyStoredThemeCss } from "../utils/theme-css/verify";

/**
 * 저자가 쓴 스타일시트 하나의 상한 — 파싱 **전에** 건다.
 *
 * 512 KiB 다. 이 리포의 가장 큰 CSS 모듈이 29 KB 이고(`src/styles/tasks.css`), 손으로 쓴
 * 스타일시트가 그 열여덟 배를 넘을 이유가 없다. 상한의 쓸모는 크기 자체가 아니라 파싱
 * 비용이다 — css-tree 는 입력을 통째로 AST 로 만들고, 그 비용은 설치 버튼을 누른
 * 사용자가 치른다. `MAX_STORED_THEME_CSS_BYTES` 의 근거 계산이 이 값을 인용한다
 * (`src-tauri/src/plugin/install.rs`).
 */
export const MAX_THEME_CSS_BYTES = 512 * 1024;

/**
 * 한 모드의 `tokens.json` 상한. `THEME_COLOR_KEYS` 개수만큼의 hex 색 지도이므로 64 KiB 면
 * 세 자릿수 여유다 —
 * 매니페스트에 거는 것과 같은 값이고, 같은 이유다(그보다 크면 테마가 아니다).
 */
export const MAX_THEME_TOKENS_BYTES = 64 * 1024;

/**
 * staged 테마에서 패키지 상대 경로 하나를 읽는 {@link ThemeAssetReader}.
 *
 * ‼️ **이 reader 가 계약을 지키는 방식은 "아무것도 하지 않는 것"이다.** 계약은
 * `inline-assets.ts` 의 `ThemeAssetReader` doc 에 있다 — "구현체는 받은 경로를 파일
 * 이름 그대로 다뤄야 한다. 퍼센트 디코드하거나 URL 로 다시 읽으면 여기서 한 봉쇄 판정이
 * 무의미해진다." 그래서 이 함수는 경로를 정규화하지도, `decodeURIComponent` 하지도,
 * `new URL(...)` 에 넣지도 않는다. 받은 문자열이 그대로 IPC 를 건너가고 Rust 의
 * `resolve_within` 이 canonicalize 로 봉쇄한다. `%2e%2e` 는 `..` 가 아니라 그런 이름의
 * 디렉터리이고, 그것이 옳은 해석이다.
 *
 * 없는 파일은 `undefined` — 계약이 정한 값이다. 다른 실패(상한 초과 등)도 여기서는
 * `undefined` 가 되는데, 그렇게 두는 이유는 단일 자산의 실질 상한이 IPC 쪽이 아니라
 * `inlineThemeAssets` 의 누적 예산이기 때문이다. Rust 의 읽기 상한은 그 예산보다 **위**에
 * 잡혀 있어서, 정상적으로 큰 자산은 `tooLarge`(경로를 알려 준다)로 거부되지 이쪽으로
 * 빠지지 않는다(`MAX_STAGED_FILE_BYTES` 주석).
 */
export function stagedThemeAssetReader(stageId: string): ThemeAssetReader {
  return async (relPath: string): Promise<Uint8Array | undefined> => {
    try {
      return await themeStageRead(stageId, relPath);
    } catch {
      return undefined;
    }
  };
}

/**
 * staged 테마의 텍스트 파일 하나를, 디코드 **전에** 바이트로 상한을 걸어 읽는다.
 *
 * 바이트로 재는 이유: 상한의 목적이 그 뒤에 오는 작업(파싱)의 비용을 묶는 것인데,
 * UTF-8 에서 문자 수와 바이트 수는 같지 않다. 문자로 재면 한글 매니페스트가 같은 상한
 * 아래에서 세 배의 바이트를 통과시킨다.
 */
export async function readStagedThemeText(
  stageId: string,
  relPath: string,
  maxBytes: number,
): Promise<string> {
  // ‼️ THE CAP GOES DOWN WITH THE REQUEST, and the check below stays (external review #2).
  // Rust stats before it reads, so an oversized file is refused without ever being
  // allocated, serialized or transferred — the "never allocate to measure" rule the crate
  // already implements for every other reader. The `byteLength` check after it is NOT
  // redundant: `themeStageRead` throws on a refusal and this function's contract is a
  // `ThemeCssError` naming the path, so the local check is what still produces that error
  // for any caller reaching this line, and it is the only gate if `maxBytes` is ever
  // dropped from the wire.
  const bytes = await themeStageRead(stageId, relPath, maxBytes);
  if (bytes.byteLength > maxBytes) {
    throw new ThemeCssError(
      "tooLarge",
      `${relPath} → ${String(bytes.byteLength)}B`,
    );
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * 설치된 테마의 저장 CSS. 주입해도 되는 것만 돌려주고, 아니면 `null`.
 *
 * ‼️ **`verifyStoredThemeCss` 를 여기서 통과시킨다.** 설치 시점에 통과했다는 사실을
 * 신뢰하지 않는 이유는 `verify.ts` 머리주석에 있다 — 설치 시점의 위생은 그때의 규칙을
 * 얼려 둘 뿐이고, 테마 디렉터리는 설치 뒤에 사람이 열어 볼 수 있다. 던지지 않고 `null`
 * 을 돌려주는 것도 그쪽 결정을 그대로 따른 것이다: 여기는 로드 경로라, 테마 하나가 앱
 * 시작을 막으면 안 된다.
 */
export async function readStoredThemeCss(
  themeId: string,
  mode: ThemeMode,
): Promise<null | string> {
  let css: string;
  try {
    css = await themeReadStoredCss(themeId, mode);
  } catch {
    // 그 모드에 CSS 가 없거나(토큰만 선언한 모드) 파일을 읽지 못했다. 둘 다 "주입할
    // CSS 가 없다" 이지 실패가 아니다 — 토큰 층은 별개로 적용된다.
    return null;
  }
  if (verifyStoredThemeCss(css)) return css;
  // ‼️ LOUD, for the reason `applyThemeCss` states and could not deliver here (0090 final
  // review, L3). That function says a rejection must not be silent — "테마가 색은 그대로인데
  // CSS 만 사라지는 증상은 로그 없이는 진단할 수 없다" — and it logs. But for an installed
  // theme verify runs HERE first and drops the bytes one step earlier, so `applyThemeCss`
  // only ever sees `undefined` and its log never fires. The claim was true of the function
  // that made it and false of the path that actually carries a community theme.
  logger.error(
    "[Theme] stored CSS no longer satisfies its contract — not applied:",
    themeId,
    mode,
  );
  return null;
}
