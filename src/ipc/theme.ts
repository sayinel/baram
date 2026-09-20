// §360 테마 설치 IPC 래퍼 (스펙 0049 §9).
//
// 이 파일은 export 여섯 개다. 그중 **설치 파이프라인 넷**(themeInstallStage·
// themeStageRead·themeInstallCommit·themeInstallDiscard)의 순서가 보안 속성이다 — 근거는
// Rust 쪽 `src-tauri/src/commands/theme_cmd.rs` 머리주석에 한 번만 적혀 있다. 여기서
// 되풀이하지 않는 이유는 그 순서를 강제하는 것이 이 파일이 아니라 커맨드 집합의
// 모양이기 때문이다(스테이징 트리에 쓰는 커맨드가 아예 없다). 나머지 둘은 그 순서 밖이다
// — `themeReadStoredCss`는 로드 시점 읽기(§361이 첫 호출자를 줬다), `themeUninstall`(§361)은
// 제거로, 설치 순서와 무관한 별개의 생명주기 동작이다.
import { invoke } from "@tauri-apps/api/core";

import type { ThemeMode } from "../types/theme";

/** 설치되지 않은, 내려받아 풀어 둔 테마 (#261 의 staged 상태와 같은 것). */
export interface RustStagedThemeInfo {
  checksum: string;
  /**
   * staged `baram-theme.json` 의 **원문**. 파싱도 검증도 여기서 하지 않는다 —
   * `validateThemeManifest` 가 유일한 구조 검증기이고, Rust 는 id 하나만 읽는다
   * (`plugin::StagedThemeInfo::manifest`).
   */
  manifest: string;
  /** 원문의 SHA-256. `themeInstallCommit` 에 그대로 돌려준다. */
  manifest_sha256: string;
  stage_id: string;
}

/** commit 이 swap 으로 실제 설치한 것. */
export interface RustCommittedThemeInfo {
  id: string;
  install_path: string;
}

/** 모드별 위생 처리된 CSS. 없는 모드는 생략한다(토큰만 선언한 모드가 그렇다). */
export interface StoredThemeCssPayload {
  dark?: string;
  light?: string;
}

/** 내려받아 `~/.baram/themes/.staging/` 에 푼다. 설치하는 것은 없다. */
export async function themeInstallStage(
  url: string,
  registryUrl: string,
  checksum: string | undefined,
  expectedId: string,
): Promise<RustStagedThemeInfo> {
  return invoke<RustStagedThemeInfo>("theme_install_stage", {
    checksum,
    expectedId,
    registryUrl,
    url,
  });
}

/**
 * 위생 처리된 CSS 를 staged 트리에 쓰고, 그 트리를 원자적으로 설치한다.
 *
 * `storedCss` 가 commit 의 인자인 것이 이 계획의 핵심이다 — 설치 경로에 CSS 가
 * 나타나는 순간이 곧 swap 이므로, 위생을 거치지 않은 CSS 가 그 경로에 앉아 있는
 * 창이 존재하지 않는다.
 */
export async function themeInstallCommit(
  stageId: string,
  expectedId: string,
  manifestSha256: string,
  storedCss: StoredThemeCssPayload,
): Promise<RustCommittedThemeInfo> {
  return invoke<RustCommittedThemeInfo>("theme_install_commit", {
    expectedId,
    manifestSha256,
    stageId,
    storedCss,
  });
}

/** staged 테마를 버린다. 설치된 것은 건드리지 않는다. */
export async function themeInstallDiscard(stageId: string): Promise<void> {
  return invoke<void>("theme_install_discard", { stageId });
}

/**
 * staged 테마 안의 파일 하나를 바이트로 읽는다.
 *
 * `path` 는 패키지 루트 기준 상대 경로이고, **파일 이름 그대로** 다뤄진다 —
 * 퍼센트 디코드도 URL 재파싱도 어느 층에서도 하지 않는다(`plugin::read_staged_file`).
 * `ThemeAssetReader` 계약이 요구하는 것이 그것이다.
 */
export async function themeStageRead(
  stageId: string,
  path: string,
): Promise<Uint8Array> {
  const buffer = await invoke<ArrayBuffer>("theme_stage_read", {
    path,
    stageId,
  });
  return new Uint8Array(buffer);
}

/** 설치된 테마의 저장 CSS(모드 하나). 그 모드에 CSS 가 없으면 reject 한다. */
export async function themeReadStoredCss(
  themeId: string,
  mode: ThemeMode,
): Promise<string> {
  return invoke<string>("theme_read_stored_css", { mode, themeId });
}

/**
 * §361 설치된 테마를 제거한다. `plugin::uninstall_installed`를 `InstallKind::Theme`로
 * 부르는 얇은 래퍼 — Task 3이 이미 kind로 일반화해 둔 것을 그대로 쓴다. 성공해도 설정
 * 스토어의 `installedThemes` 기록은 이 함수가 지우지 않는다: 호출자가
 * `removeInstalledTheme`으로 따로 지운다(플러그인의 `handleUninstall`과 같은 순서 —
 * 디스크 삭제가 실패하면 기록을 남겨 사라진 척하지 않는다).
 */
export async function themeUninstall(themeId: string): Promise<void> {
  return invoke<void>("theme_uninstall", { themeId });
}
