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
import type { RegistryEntry } from "../plugins/types";
import type { ThemeColors, ThemeMode } from "../types/theme";
import type { ThemeManifest } from "./theme-manifest";

import {
  themeInstallCommit,
  themeInstallDiscard,
  themeInstallStage,
} from "../ipc/theme";
import { THEME_COLOR_KEYS, THEME_COLOR_VALUE_RE } from "../types/theme";
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

const MODE_KEYS: readonly ThemeMode[] = ["light", "dark"];

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
  const source = parsed as Record<string, unknown>;
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
 * ‼️ **다만 그 되풀이가 오늘 무엇을 잡는지는 모른다 — 실측했고, 답은 "아무것도" 다.**
 * verify 의 네 계약을 앞 두 층이 이미 덮는다: 계약 1(`@layer` 래핑)은 sanitize 의 출력
 * 형태 자체이고, 계약 2(`data:` 만)는 inline 의 `assertOnlyDataUrls` 가 같은 순회로 보고,
 * 계약 3·4(`!important`·`@import`)는 sanitize 가 제거하거나 거부한다. 중첩 규칙으로
 * sanitize 의 AST 워크를 우회해 `!important` 를 남기려 시도했지만(`html{body{…}}`,
 * 세 겹, `@media` 안) 셋 다 sanitize 의 엄격한 1차 파스가 `parseFailed` 로 먼저 거부했다.
 * 그래서 **이 줄을 빨갛게 만드는 입력을 만들지 못했고, 이 줄에는 테스트가 없다.**
 * 남겨 두는 이유는 세 층의 규칙 집합이 서로 독립이기 때문이다 — sanitize 의 1차 파스가
 * 언젠가 완화되면(중첩 CSS 를 받게 되면) 그 순간 이 줄이 유일한 관문이 된다. 지우는 쪽이
 * 아니라 적어 두는 쪽을 골랐다.
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
  if (inlined.length > MAX_STORED_THEME_CSS_BYTES) {
    throw new ThemeCssError(
      "tooLarge",
      `${relPath} → ${String(inlined.length)}B stored`,
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

/** {@link installTheme} 이 돌려주는 것. 실패는 `error` 코드 하나로 좁혀 온다. */
export type ThemeInstallResult =
  | {
      detail?: string;
      errors?: { field: string; message: string }[];
      ok: false;
      reason: ThemeInstallFailure;
    }
  | { installed: InstalledTheme; ok: true };

/** 설치가 멈춘 이유. UI 가 locale 문장으로 바꾼다. */
export type ThemeInstallFailure =
  | "commitFailed"
  | "cssRejected"
  | "downloadFailed"
  | "idMismatch"
  | "manifestInvalid";

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

    // ‼️ 위생은 여기서 **전부** 끝난다. 아래 commit 아래로는 아무 검증도 없다.
    const modes: Partial<Record<ThemeMode, InstalledThemeMode>> = {};
    const storedCss: Partial<Record<ThemeMode, string>> = {};
    for (const mode of MODE_KEYS) {
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
    return {
      ok: true,
      installed: {
        id: committed.id,
        installedAt: new Date().toISOString(),
        installPath: committed.install_path,
        manifest,
        modes,
        checksum: staged.checksum,
      },
    };
  } catch (err) {
    logger.error("[Theme] install failed:", err);
    const failure: ThemeInstallResult = {
      ok: false,
      reason: reasonFor(err),
      detail: err instanceof ThemeCssError ? err.code : undefined,
    };
    return stageId === null ? failure : await discard(stageId, failure);
  }
}

/**
 * 어느 단계에서 멈췄는지.
 *
 * `ThemeCssError` 는 위생 세 층이 던지는 유일한 오류 타입이므로 그것이 곧 "CSS 가
 * 거부됐다" 이고, 나머지는 스테이징(다운로드·checksum·origin) 아니면 commit 이다.
 * commit 실패를 다운로드 실패와 섞지 않는 이유는 사용자가 할 일이 다르기 때문이다 —
 * 전자는 디스크, 후자는 네트워크다.
 */
function reasonFor(err: unknown): ThemeInstallFailure {
  if (err instanceof ThemeCssError) return "cssRejected";
  if (typeof err === "string" && err.includes("staged")) return "commitFailed";
  return "downloadFailed";
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
