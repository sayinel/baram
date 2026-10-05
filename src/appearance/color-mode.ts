// §367 색 파생이 쓰는 모드. `types/theme.ts` 의 `resolveThemeMode` 과 **다른
// 질문에 답한다**: 저쪽은 "이 테마의 어느 모드 자산을 적용하는가" 라 자산이
// 없으면 `undefined` 가 정답이고, 이쪽은 "지금 화면이 밝은가 어두운가" 라
// 답이 언제나 둘 중 하나다. 파생식은 명도 방향을 그 답에서 가져오므로
// `undefined` 를 받을 자리가 없다.
//
// §386 모드 설정(스펙 0064)도 여기 있다. 앱이 OS 의 `prefers-color-scheme` 를 묻던
// 자리는 이제 `prefersDarkFor` 를 묻고, `<html data-theme>` · 모드 자산 · 읽어 올 테마
// CSS 가 따를 모드는 `appliedThemeMode` 하나가 정한다 — 적용 이펙트
// (`use-settings-effects.ts`)와 편집기 복원(`ThemeEditor.tsx` 의 `restorePreview`)이
// 같은 답을 내야 복원이 적용과 어긋나지 않는다(스펙 D6).

import type { ThemeDef, ThemeMode } from "../types/theme";

import { resolveThemeMode, themeModes } from "../types/theme";

/** 지금 화면의 밝기. `ThemeMode` 와 같은 두 값이고, 이 모듈은 그것을 재export 하지 않는다 —
 *  `types/theme.ts` 는 팔레트 생성물을 import 하므로 잎이 아니다. */
export type ColorMode = "dark" | "light";

/** §386 모드 설정의 값(스펙 0064 D1). 배열 순서가 외관 탭의 선택지 순서다. */
export const COLOR_MODE_SETTINGS = ["system", "light", "dark"] as const;

export type ColorModeSetting = (typeof COLOR_MODE_SETTINGS)[number];

/**
 * `<html data-theme>` 과 모드 자산이 따를 모드. `undefined` 면 속성을 지우고 미디어 쿼리에 맡긴다.
 *
 * 테마가 모드를 정하면 그 답이다 — 한 모드짜리는 그 모드(스펙 D4), 두 모드는 설정이 고른 쪽.
 * 테마가 정하지 못하는 경우(`system` · 해석되지 않는 id 인 `undefined`, 모드를 선언하지 않은
 * 테마)는 기본 팔레트가 cascade 로 그려지므로, 설정이 고정이면 그 모드를 넣고 `"system"` 이면
 * 비운다 — 설정이 비동기로 읽히기 전 첫 페인트를 미디어 쿼리가 맞게 그리게 하려는 것이다(D7).
 */
export function appliedThemeMode(
  theme: ThemeDef | undefined,
  setting: ColorModeSetting,
  osPrefersDark: boolean,
): ThemeMode | undefined {
  const resolved =
    theme === undefined
      ? undefined
      : resolveThemeMode(theme, prefersDarkFor(setting, osPrefersDark));
  return resolved ?? (setting === "system" ? undefined : setting);
}

/**
 * 이 테마를 입은 동안 모드 설정이 화면을 바꾸는가 — 외관 탭이 모드 행을 보일지(스펙 D2).
 * 한 모드짜리 테마만 거짓이다: 그 테마의 모드가 언제나 이긴다(D4, `appliedThemeMode`).
 */
export function followsColorModeSetting(theme: ThemeDef | undefined): boolean {
  return theme === undefined || themeModes(theme).length !== 1;
}

/** 앱이 OS 의 `prefers-color-scheme` 대신 읽는 값 — 설정이 `"system"` 일 때만 OS 를 따른다. */
export function prefersDarkFor(
  setting: ColorModeSetting,
  osPrefersDark: boolean,
): boolean {
  return setting === "system" ? osPrefersDark : setting === "dark";
}

/**
 * 지금 화면이 라이트인가 다크인가 — **언제나 답한다**.
 *
 * 한 모드짜리 테마가 `prefersDark` 를 무시하는 규칙은 {@link resolveThemeMode} 이
 * 이미 갖고 있으므로 여기서 다시 적지 않는다. 이 함수가 더하는 것은 그 함수가
 * 말하지 않는 갈래 하나뿐이다: 적용할 모드 자산이 없을 때(`system`, 그리고 모드를
 * 선언하지 않은 테마) 화면의 밝기는 `prefersDark` 가 정한다 — 색 다이얼 파생의
 * 호출자는 `prefersDarkFor(colorModeSetting, osPrefersDark)` 의 답을 넘기므로,
 * 모드 설정이 고정이면 OS 와 무관하게 그 답이 이긴다.
 */
export function resolveColorMode(
  theme: ThemeDef | undefined,
  prefersDark: boolean,
): ColorMode {
  const resolved =
    theme === undefined ? undefined : resolveThemeMode(theme, prefersDark);
  return resolved ?? (prefersDark ? "dark" : "light");
}
