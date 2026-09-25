// §360 테마 설치 — 위생 파이프라인을 설치 경로에 건다 (스펙 0049 §7·§9).
//
// ‼️ **순서가 보안 속성이다.** staged 트리에서 읽고 → 위생 → 인라인 → 저장 → commit.
// 커밋한 뒤에 위생 처리하면, 그 사이에 검증되지 않은 CSS 가 설치 경로에 앉아 있는 창이
// 생긴다. 여기서는 그 창이 **구조적으로** 없다: 저장은 commit 의 인자이고(`storedCss`),
// 설치 경로를 만드는 것이 곧 그 commit 의 swap 이다. staged 트리에 쓰는 IPC 커맨드는
// 존재하지 않으므로 이 순서를 우회할 방법도 없다(`src-tauri/src/commands/theme_cmd.rs`).
//
// 세 층은 각각 다른 것을 본다 — 하나로 합치면 자산을 가진 테마가 전부 거부된다:
//   sanitizeThemeCss   저자가 쓴 CSS  → 패키지 상대 경로만, `@layer` 로 감싼다
//   inlineThemeAssets  그 출력        → 상대 경로를 `data:` 로 바꾼다
//   verifyStoredThemeCss 저장 CSS     → `data:` 만. 저장 직전과 로드 시점, 두 번 돈다
//
// 실패는 전부 `discard` 로 끝난다 — 설치된 것은 아무것도 건드리지 않았으므로 "복구" 가
// 아니라 "내려받은 것을 버린다" 이다(#261).
import type { ContrastWarning } from "../appearance/contrast-report";
import type { RegistryEntry } from "../plugins/types";
import type { ThemeColors, ThemeMode } from "../types/theme";
import type { ThemeManifest } from "./theme-manifest";

import { contrastWarningsFor } from "../appearance/contrast-report";
import {
  themeInstallCommit,
  themeInstallDiscard,
  themeInstallStage,
} from "../ipc/theme";
import { unmetFloorAgainstApp } from "../plugins/engines-app";
import {
  fillAliasedColors,
  RESERVED_THEME_IDS,
  THEME_COLOR_KEYS,
  THEME_COLOR_VALUE_RE,
  THEME_MODES,
} from "../types/theme";
import { logger } from "../utils/logger";
import { ThemeCssError } from "../utils/theme-css/errors";
import { inlineThemeAssets } from "../utils/theme-css/inline-assets";
import { sanitizeThemeCss } from "../utils/theme-css/sanitize";
import { verifyStoredThemeCss } from "../utils/theme-css/verify";
import { validateThemeManifest } from "./theme-manifest";
import {
  MAX_THEME_CSS_BYTES,
  MAX_THEME_TOKENS_BYTES,
  readStagedThemeText,
  stagedThemeAssetReader,
} from "./theme-store-fs";

/**
 * `baram-theme.json` 원문의 상한 — `JSON.parse` **앞**에 선다.
 *
 * ‼️ Task 2 의 `MAX_MANIFEST_JSON_CHARS` 와 중복이 아니다. `validateThemeManifest` 는
 * **이미 파싱된** `data`를 받으므로 그쪽 `JSON.stringify` 검사가 묶는 것은 필드별 검사
 * 비용이지 파싱 비용이 아니다. 여기가 파싱 비용을 묶는 자리다. 값이 같은 것은 우연이
 * 아니라 같은 근거다 — `use-theme-import.ts:72` 가 가져오기 파일 전체에 거는 64 KiB.
 *
 * Rust 도 staged 아카이브를 읽을 때 같은 값으로 자른다(`MAX_THEME_MANIFEST_BYTES`).
 * 어느 층도 앞 층이 돌았다고 가정하지 않는다: 이 함수는 아카이브를 거치지 않은 호출자
 * (스펙 §12.2 의 개발 폴더 테마)에게도 **유일한** 관문이다.
 */
export const MAX_THEME_MANIFEST_BYTES = 64 * 1024;

/** 설치가 남긴 기록. 스토어가 이것을 들고 있고, 디스크를 다시 열거하지 않는다. */
export interface InstalledTheme {
  /** 이 설치가 내려받은 아카이브의 SHA-256. */
  checksum: string;
  /**
   * §361 스펙 §9.3 — §260 의 동의 기록 구조(승인 시각 + 승인한 버전)를 그대로 재사용한다.
   * `installedAt`/`manifest.version` 에서 파생하지 **않는다** — 저 둘은 나중에 같은 함수가
   * 업데이트로 다시 부를 때 새 값으로 갈리지만, 테마는 capabilities 가 없어 재동의를
   * 요구할 일이 없으므로 동의는 **최초 설치 그 순간 한 번**이다.
   *
   * ‼️ **업데이트 경로(Task 6)는 이 두 필드를 다시 계산하지 말고 그대로 옮겨야 한다.**
   * 이 함수는 오늘 최초 설치만 호출하므로 아래 값은 지금은 항상 옳다 — 업데이트가
   * 생기는 순간 이 doc 주석이 그 계약이다.
   */
  consentedAt: string;
  /** @see consentedAt */
  consentedVersion: string;
  id: string;
  installedAt: string;
  installPath: string;
  manifest: ThemeManifest;
  /** 이 설치가 실제로 저장한 것. 선언만 있고 파일이 없던 모드는 여기 없다. */
  modes: Partial<Record<ThemeMode, InstalledThemeMode>>;
}

export interface InstalledThemeMode {
  /** 이 모드의 토큰 — `tokens.json` 이 있었다면. */
  colors?: ThemeColors;
  /** 이 모드의 저장 CSS 가 디스크에 있는가. 내용은 로드 시점에 읽는다. */
  css: boolean;
}

/**
 * 매니페스트 원문을 검증된 {@link ThemeManifest} 로.
 *
 * 상한 → `JSON.parse` → `validateThemeManifest` 순서다. 실패는 `ThemeCssError` 가
 * 아니라 이 함수의 반환값으로 나온다 — 매니페스트 오류는 제작자가 고칠 **필드**를 짚어
 * 줘야 하고, `validateThemeManifest` 가 그 목록을 이미 만든다.
 */
export function parseThemeManifestText(
  text: string,
):
  | { errors: { field: string; message: string }[]; valid: false }
  | { manifest: ThemeManifest; valid: true } {
  // 바이트로 잰다. 문자로 재면 한글이 든 매니페스트가 같은 상한 아래에서 최대 세 배의
  // 바이트를 통과시키고, 묶으려던 파싱 비용은 바이트에 비례한다.
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > MAX_THEME_MANIFEST_BYTES) {
    return {
      valid: false,
      errors: [
        {
          field: "root",
          message: `manifest is ${String(bytes)} bytes, over the ${String(MAX_THEME_MANIFEST_BYTES)}-byte limit`,
        },
      ],
    };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return {
      valid: false,
      errors: [
        {
          field: "root",
          message: `manifest is not valid JSON: ${String(err)}`,
        },
      ],
    };
  }
  return validateThemeManifest(data);
}

/**
 * 패키지 상대 경로의 `tokens.json` 을 읽어 {@link ThemeColors} 로.
 *
 * 화이트리스트 키만으로 객체를 **재구성**한다 — `use-theme-import.ts` 가 감사 BLOCKER
 * 로 고친 것과 같은 규칙이고, 이유도 같다: 존재만 검사하고 객체를 그대로 저장하면 JSON
 * 에 끼어든 여분 키(진짜 CSS 속성명 포함)가 `applyThemeVars` 까지 흘러가 `<html>` 의
 * inline style 에 영구 주입된다.
 *
 * 키가 하나라도 빠지거나 형식이 틀리면 `undefined` — 부분 팔레트를 기본값으로 메우지
 * 않는다. 가져오기 경로는 `base` 를 알기 때문에 그 모드의 기본 팔레트로 메울 수 있지만,
 * 패키지 테마는 두 모드를 함께 실을 수 있어 "이 모드의 기본값" 이 하나로 정해지지 않는다.
 *
 * 단 **포맷보다 늦게 생긴 키**는 빠진 것으로 세지 않는다 — 검사 전에 `fillAliasedColors`
 * 가 그 키를 이 팔레트 안의 별칭 값으로 채운다. v0.7.4 가 내보낸 24키 패키지가 25키 빌드에서
 * 팔레트를 통째로 잃던 것(#722 의 범위 밖 1)이 그 이유다. 채우는 값이 기본 팔레트가 아니라
 * 같은 팔레트에서 오므로 위 규칙("기본값으로 메우지 않는다")은 그대로다.
 */
async function readModeColors(
  stageId: string,
  relPath: string,
): Promise<ThemeColors | undefined> {
  let parsed: unknown;
  try {
    const text = await readStagedThemeText(
      stageId,
      relPath,
      MAX_THEME_TOKENS_BYTES,
    );
    parsed = JSON.parse(text);
  } catch (err) {
    logger.warn(`[Theme] ${relPath} could not be read:`, err);
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const source = fillAliasedColors(parsed as Record<string, unknown>);
  const colors = {} as ThemeColors;
  for (const { key } of THEME_COLOR_KEYS) {
    const value = source[key];
    if (typeof value !== "string" || !THEME_COLOR_VALUE_RE.test(value)) {
      logger.warn(`[Theme] ${relPath} has no usable value for ${key}`);
      return undefined;
    }
    colors[key] = value;
  }
  return colors;
}

/**
 * 한 모드의 CSS 를 위생 처리해 저장할 문자열로 만든다.
 *
 * 세 층 전부를 여기서 지난다. 마지막 `verifyStoredThemeCss` 는 로드 시점 검사의
 * **복사가 아니라 되풀이**다: 지금 통과하지 못하는 것을 저장하면 그 실패가 다음 실행까지
 * 미뤄지고, 원인에서 먼 곳에서 "테마가 적용되지 않는다" 로만 드러난다.
 *
 * ‼️ **그리고 그 되풀이가 실제로 혼자 잡는 입력이 있다.** verify 의 계약 2 는 두 반쪽이고,
 * 둘째 반쪽인 `hasUrlSpelledAsFunction` 은 `verify.ts` 에만 있다 — 앞 두 층 어느 쪽도
 * 공유하지 않는다. `@media (scripting:url("x.png")){…}` 의 media-feature 값은 느슨한
 * 문법으로 파싱돼 `Url` 이 아니라 `Function:url` 이 되고, 그래서 sanitize 를 통과하고
 * inline 도 통과한다(인라인이 거기 `url("data:…")` 를 심는다). 그 결과를 거부하는 것은
 * 이 줄뿐이다. `verify.ts` 가 그 자리를 실측과 함께 이미 적어 두었고, 아래 테스트가
 * 그것을 고정한다 — `a mode whose CSS only the stored-CSS verify can refuse`.
 *
 * (이 함수를 처음 쓸 때는 "네 계약을 앞 두 층이 덮는다" 고 적었다. 네 입력을 만들어 보고
 * 못 찾아서 그렇게 판단했는데, 답은 부르고 있는 함수의 주석 안에 이미 있었다.)
 */
async function sanitizedModeCss(
  stageId: string,
  relPath: string,
): Promise<string> {
  const authored = await readStagedThemeText(
    stageId,
    relPath,
    MAX_THEME_CSS_BYTES,
  );
  const sanitized = sanitizeThemeCss(authored);
  const inlined = await inlineThemeAssets(
    sanitized,
    stagedThemeAssetReader(stageId),
  );
  const stored = storedCssByteLength(inlined);
  if (stored > MAX_STORED_THEME_CSS_BYTES) {
    throw new ThemeCssError(
      "tooLarge",
      `${relPath} → ${String(stored)}B stored`,
    );
  }
  if (!verifyStoredThemeCss(inlined)) {
    throw new ThemeCssError("parseFailed", `${relPath} failed its own verify`);
  }
  return inlined;
}

/**
 * 저장 CSS 하나의 상한.
 *
 * ‼️ **값의 집은 Rust 다** — `MAX_STORED_THEME_CSS_BYTES`
 * (`src-tauri/src/plugin/install.rs`)가 쓰기를 거부하는 실제 관문이고, 여기 있는 것은
 * 그보다 앞서 더 나은 오류로 거부하기 위한 사본이다. 근거(왜 자산 예산에서 유도할 수
 * 없는지, 4 MiB 가 어떻게 나왔는지)는 그 상수 주석에 한 번만 적혀 있다.
 * `stored-css-cap-parity.test.ts` 가 두 값을 묶는다 — 한쪽만 고치면 빨개진다.
 */
export const MAX_STORED_THEME_CSS_BYTES = 4 * 1024 * 1024;

/**
 * 저장 CSS 의 크기를 **Rust 가 재는 것과 같은 단위**로 — UTF-8 바이트.
 *
 * ‼️ 함수로 빼 둔 이유는 `.length` 로 쓰면 틀리고, 그 틀림이 조용하기 때문이다.
 * JavaScript 의 `String.length` 는 UTF-16 코드 유닛이고 Rust 의 `String::len()` 은
 * UTF-8 바이트다. 한글 한 글자는 코드 유닛 1, 바이트 3 이므로 `.length` 로 재면 앞단이
 * 뒷단보다 **느슨한** 상한이 된다 — 두 값이 같은 숫자여도 뜻이 다르면 parity 테스트는
 * 초록인 채로 어긋난다(`rust-constants.ts` 가 막으려는 바로 그 drift 다).
 *
 * 값이 아니라 **단위**를 고정하려고 export 한다 — `stored-css-cap-parity.test.ts` 가
 * `"가"` 하나로 3 을 요구한다. 4 MiB 짜리 입력을 만들지 않고도 `.length` 로의 회귀가
 * 빨개진다.
 *
 * (오늘 이 차이가 실제로 상한을 갈라놓지는 않는다 — 계산은 리포트에 있다. 다른 두 상한이
 * 바뀌면 갈라질 수 있고, 어느 쪽이든 앞단이 뒷단보다 느슨할 이유가 없다.)
 */
export function storedCssByteLength(css: string): number {
  return new TextEncoder().encode(css).byteLength;
}

/** {@link installTheme} 이 돌려주는 것. 실패는 `error` 코드 하나로 좁혀 온다. */
export type ThemeInstallResult =
  | {
      detail?: string;
      errors?: { field: string; message: string }[];
      ok: false;
      reason: ThemeInstallFailure;
    }
  | {
      installed: InstalledTheme;
      ok: true;
      /**
       * §367.3 설치를 막지 **않은** 대비 경고. 비어 있으면 필드를 싣지 않는다.
       * 실패 갈래(`THEME_INSTALL_FAILURE_REASONS`)에 값을 더하지 않는 것이
       * 요점이다 — 이것은 실패가 아니다.
       */
      warnings?: ContrastWarning[];
    };

/**
 * 설치가 멈춘 이유. UI 가 locale 문장으로 바꾼다.
 *
 * 타입이 아니라 배열이 원본이다 — `THEME_CSS_ERROR_CODES`(`utils/theme-css/errors.ts`)와
 * 같은 이유다. 이 배열이 있어야 "이 값 하나하나에 문장이 붙는가"를 런타임에 셀 수 있고,
 * 그 검사는 `i18n/__tests__/label-key-coverage.test.ts`에 있다.
 */
export const THEME_INSTALL_FAILURE_REASONS = [
  /** 다운로드·checksum·origin 검사·아카이브 추출 중 실패했다. */
  "downloadFailed",
  /** 매니페스트는 읽었지만 위생 파이프라인(sanitize·inline·verify) 어느 층이 거부했다. */
  "cssRejected",
  /** 다운로드한 매니페스트의 `id`가 레지스트리 항목의 `id`와 다르다. */
  "idMismatch",
  /** `validateThemeManifest`가 구조를 거부했다. `errors`에 필드별 사유가 실린다. */
  "manifestInvalid",
  /** 위생을 통과한 뒤 Rust 쪽 commit(디스크 쓰기·원자적 swap)이 실패했다. */
  "commitFailed",
  /** 매니페스트가 선언한 `engines.baram` 하한을 이 앱 버전이 만족하지 못한다 (M1). */
  "appTooOld",
  /** id 가 내장 테마(또는 `system`)의 것이다 — {@link RESERVED_THEME_IDS} (M2). */
  "reservedId",
] as const;

export type ThemeInstallFailure =
  (typeof THEME_INSTALL_FAILURE_REASONS)[number];

/**
 * 레지스트리 항목 하나를 설치한다.
 *
 * `entry.kind` 가 `"theme"` 인지는 호출자가 이미 판단했다 — 이 함수는 테마 트리에만
 * 설치하므로 플러그인을 여기로 보내면 `baram-theme.json` 이 없어 스테이징에서 멈춘다.
 */
export async function installTheme(
  entry: RegistryEntry,
  registryUrl: string,
): Promise<ThemeInstallResult> {
  let stageId: null | string = null;
  // ‼️ 실패 분류는 **어느 await 이 던졌는가**로 한다. 앞선 판은 오류 문자열에
  // `"staged"` 가 들었는지로 갈랐는데, commit 이 돌려줄 수 있는 문자열 일곱 중 셋만
  // 잡혔다 — Rust 의 상한 거부·`a theme commit must carry its sanitized CSS`·
  // `invalid stage id`·`write_stored_theme_css` 와 `swap_into_place` 의 모든 IO 오류가
  // 전부 `downloadFailed` 로 떨어졌다. 즉 디스크가 가득 찬 사용자에게 네트워크를
  // 확인하라고 말한다. 문자열은 Rust 쪽 문구가 바뀌면 조용히 더 틀려지는데, 이 변수는
  // 다음에 던질 수 있는 await 을 코드가 스스로 선언하므로 그 방식으로 틀릴 수 없다.
  let phase: ThemeInstallFailure = "downloadFailed";
  try {
    const staged = await themeInstallStage(
      entry.downloadUrl,
      registryUrl,
      entry.checksum,
      // Rust 가 아카이브의 id 를 이 값과 대조한다. 적대적인 목록이 이 다운로드를
      // 무관한 설치 디렉터리로 겨누지 못하게 하는 것이 그 검사다(§260 Phase 5 R5).
      entry.id,
    );
    stageId = staged.stage_id;

    const parsed = parseThemeManifestText(staged.manifest);
    if (!parsed.valid) {
      return await discard(stageId, {
        ok: false,
        reason: "manifestInvalid",
        errors: parsed.errors,
      });
    }
    const manifest = parsed.manifest;
    // Rust 도 대조했다. 여기서 다시 보는 이유는 `stage_install` 의 검사가
    // `expected_id` 를 받았을 때만 도는 반면, 이 비교는 **우리가 방금 검증한**
    // 매니페스트와 목록이 같은 것을 말하는지 보기 때문이다 — 층이 다르다.
    if (manifest.id !== entry.id) {
      return await discard(stageId, {
        ok: false,
        reason: "idMismatch",
        detail: `${entry.id} → ${manifest.id}`,
      });
    }

    // M2 — an id the built-in themes already own can be installed but never worn:
    // `findThemeById` searches `BUILT_IN_THEMES` first. The set's own doc comment carries
    // the rest, including what a WITHDRAWAL for such an id would reach. Checked against the
    // DOWNLOADED manifest's id, which is the one just compared to the listing, so the gate
    // cannot be sidestepped by a listing that disagrees with its archive.
    if (RESERVED_THEME_IDS.has(manifest.id)) {
      return await discard(stageId, {
        ok: false,
        reason: "reservedId",
        detail: manifest.id,
      });
    }

    // M1 — the `engines.baram` floor, against the ARCHIVE. Spec §9.1 lists this as reused
    // from §69 and nothing on the theme path applied it; `validateThemeManifest` checks the
    // field is a non-empty string and stops. The listing is judged separately, before the
    // download, in `use-theme-actions.ts` — same two-sided shape as the plugin path, and
    // for its reason: the entry is a claim, the archive is the truth.
    const unmetFloor = await unmetFloorAgainstApp(manifest.engines);
    if (unmetFloor !== null) {
      return await discard(stageId, {
        ok: false,
        reason: "appTooOld",
        detail: unmetFloor.floor,
      });
    }

    // ‼️ 위생은 여기서 **전부** 끝난다. 아래 commit 아래로는 아무 검증도 없다.
    //
    // 이 구간에서 던지는 것은 `sanitizedModeCss` 뿐이고(`readModeColors` 는 자기 실패를
    // 삼키고 `undefined` 를 돌려준다), 그 실패는 전부 "패키지의 CSS 가 거부됐다" 이다 —
    // 세 층의 `ThemeCssError` 도, 선언된 CSS 파일이 패키지에 없어서 나는 읽기 실패도.
    phase = "cssRejected";
    const modes: Partial<Record<ThemeMode, InstalledThemeMode>> = {};
    const storedCss: Partial<Record<ThemeMode, string>> = {};
    for (const mode of THEME_MODES) {
      const declared = manifest.modes[mode];
      if (declared === undefined) continue;
      const colors =
        declared.tokens === undefined || declared.tokens === ""
          ? undefined
          : await readModeColors(stageId, declared.tokens);
      let css: string | undefined;
      if (declared.css !== undefined && declared.css !== "") {
        css = await sanitizedModeCss(stageId, declared.css);
        storedCss[mode] = css;
      }
      modes[mode] = { colors, css: css !== undefined };
    }

    phase = "commitFailed";
    const committed = await themeInstallCommit(
      stageId,
      entry.id,
      // 이 digest 가 위 검증을 그 파일에 못 박는다. stage 는 두 IPC 호출 사이에
      // 디스크에 앉아 있고, commit 은 디스크에서 다시 읽는다(#261 보안 리뷰).
      staged.manifest_sha256,
      storedCss,
    );
    // commit 아래로는 던질 수 있는 것이 없으므로 아래 `catch` 는 커밋된 stage 를 버리려
    // 들 수 없다 — "이미 커밋했음" 플래그를 두지 않는 이유다. 설령 미래의 편집이 그 사이에
    // 던지는 호출을 넣더라도 손해는 없다: swap 이 stage 디렉터리를 이미 가져갔으므로
    // `discard` 는 `NotFound` 로 끝나고, 그 실패는 로그에만 남는다.
    //
    // §361 — `consentedAt`/`consentedVersion`은 여기서 `installedAt`/`manifest.version`과
    // 같은 순간·같은 값으로 한 번 정해진다. 이 함수는 오늘 최초 설치만 호출하므로 셋이
    // 같은 것이 옳다 — `InstalledTheme.consentedAt`의 doc 주석이 그 계약을 적어 둔다.
    const now = new Date().toISOString();
    // §367.3 — 위생과 무관한 미학 판단이라 commit 뒤, 실패로 셀 수 없는 자리에서 잰다.
    const warnings = THEME_MODES.flatMap((mode) => {
      const colors = modes[mode]?.colors;
      return colors === undefined ? [] : contrastWarningsFor(mode, colors);
    });
    return {
      ok: true,
      installed: {
        checksum: staged.checksum,
        consentedAt: now,
        consentedVersion: manifest.version,
        id: committed.id,
        installedAt: now,
        installPath: committed.install_path,
        manifest,
        modes,
      },
      ...(warnings.length > 0 && { warnings }),
    };
  } catch (err) {
    logger.error("[Theme] install failed:", err);
    const failure: ThemeInstallResult = {
      ok: false,
      reason: phase,
      detail: err instanceof ThemeCssError ? err.code : undefined,
    };
    return stageId === null ? failure : await discard(stageId, failure);
  }
}

/** stage 를 버리고 원래의 실패를 돌려준다. 버리기가 실패해도 원인은 그쪽이 아니다. */
async function discard(
  stageId: string,
  failure: ThemeInstallResult,
): Promise<ThemeInstallResult> {
  try {
    await themeInstallDiscard(stageId);
  } catch (err) {
    logger.error("[Theme] discarding the staged install failed:", err);
  }
  return failure;
}
