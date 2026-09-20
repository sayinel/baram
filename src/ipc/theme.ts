// §360 테마 설치 IPC 래퍼 (스펙 0049 §9).
//
// 다섯 커맨드의 순서가 곧 보안 속성이다 — 근거는 Rust 쪽
// `src-tauri/src/commands/theme_cmd.rs` 머리주석에 한 번만 적혀 있다. 여기서
// 되풀이하지 않는 이유는 그 순서를 강제하는 것이 이 파일이 아니라 커맨드 집합의
// 모양이기 때문이다(스테이징 트리에 쓰는 커맨드가 아예 없다).
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
