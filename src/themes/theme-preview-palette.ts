// §356 테마 미리보기의 공용 계약 — 미리보기 그림이 읽는 색 키와, 테마에서 그 팔레트를
// 만드는 함수.
//
// 계약이 컴포넌트 밖에 있는 이유: 미리보기를 그리는 자리가 둘이 될 것이기 때문이다.
// 외관 탭 갤러리는 설치된 테마의 `ThemeDef` 에서 팔레트를 만들고, 테마 찾아보기는
// 레지스트리 색인에 실린 팔레트를 **같은 키로** 받는다(아직 없다 — 레지스트리 색인에
// 미리보기 필드가 생길 때 꽂힌다). 키 목록이 한 곳이어야 두 화면이 같은 그림을 그린다.
//
// ‼️ 키는 전부 테마 패키지가 싣는 **시드**다(`THEME_COLOR_KEYS`). 파생 키나 역할 토큰을
// 넣으면 레지스트리가 게시 단계에서 패키지로부터 그 값을 뽑을 수 없다 — 테스트가 부분집합을
// 고정한다.

import type { ThemeDef, ThemeMode } from "../types/theme";
import type { ThemeColorKey, ThemeColors } from "../types/theme-color-keys";

import { DEFAULT_DARK_PALETTE } from "../types/generated/palette-dark";
import { DEFAULT_LIGHT_PALETTE } from "../types/generated/palette-light";
import { THEME_MODES } from "../types/theme";

/** 미리보기 그림이 칠하는 색 — 그림의 어느 부분인지는 `theme-preview.tsx` 가 적는다. */
export const PREVIEW_COLOR_KEYS = [
  "--color-bg-default",
  "--color-bg-panel",
  "--color-bg-subtle",
  "--color-bg-elevated",
  "--color-border-default",
  "--color-text-primary",
  "--color-text-secondary",
  "--color-accent-default",
  "--color-accent-subtle",
  "--color-editor-bg",
  "--color-editor-text",
  "--color-editor-selection",
  "--color-editor-cursor",
  "--color-status-warning",
  "--color-status-success",
  "--color-status-danger",
] as const satisfies readonly ThemeColorKey[];

export type PreviewColorKey = (typeof PREVIEW_COLOR_KEYS)[number];

export type PreviewPalette = Readonly<Record<PreviewColorKey, string>>;

/** 선언된 모드마다 하나. 둘 다 있으면 그림이 좌우로 나뉜다. */
export interface PreviewPalettes {
  readonly dark?: PreviewPalette;
  readonly light?: PreviewPalette;
}

const BASE_PALETTE: Record<ThemeMode, ThemeColors> = {
  dark: DEFAULT_DARK_PALETTE,
  light: DEFAULT_LIGHT_PALETTE,
};

/**
 * 테마 색 → 미리보기 팔레트. 빠진 키는 그 모드의 기본 팔레트로 채운다.
 *
 * 적용 경로(`applyThemeVars`)는 빠진 키를 인라인으로 쓰지 않으므로 그 키는 그 모드의 CSS
 * 기본값으로 떨어진다. 그 기본값과 이 생성 팔레트는 같은 토큰 파일
 * (`tokens/semantic/color-{light,dark}.json`)에서 나온다 — 그래서 채운 그림이 입었을 때의
 * 화면과 같다. 저장된 커스텀 테마는 키가 빠질 수 있는 실제 입력이다(`config.json` 은 손으로
 * 고칠 수 있고, 시드가 늘기 전에 저장된 팔레트도 있다).
 */
export function previewPaletteFrom(
  colors: Partial<ThemeColors>,
  mode: ThemeMode,
): PreviewPalette {
  const base = BASE_PALETTE[mode];
  const out = {} as Record<PreviewColorKey, string>;
  for (const key of PREVIEW_COLOR_KEYS) out[key] = colors[key] ?? base[key];
  return out;
}

/**
 * 테마가 선언한 모드 가운데 **색을 가진** 모드의 팔레트.
 *
 * CSS 만 싣는 모드(§358)는 빠진다 — 기본 팔레트로 채우면 그 테마와 무관한 그림이 그
 * 테마의 미리보기로 보인다. 결과가 비면 그릴 것이 없다는 뜻이다.
 */
export function themePreviewPalettes(theme: ThemeDef): PreviewPalettes {
  const out: { dark?: PreviewPalette; light?: PreviewPalette } = {};
  for (const mode of THEME_MODES) {
    const colors = theme.modes[mode]?.colors;
    if (colors !== undefined) out[mode] = previewPaletteFrom(colors, mode);
  }
  return out;
}
