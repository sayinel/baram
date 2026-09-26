// §356 테마 미리보기의 공용 계약 — 갤러리가 지금 쓰고, 테마 찾아보기가 레지스트리
// 색인의 팔레트로 나중에 같은 키를 채운다.
import type { ThemeDef } from "../../types/theme";
import type { ThemeColors } from "../../types/theme-color-keys";

import { describe, expect, it } from "vitest";

import { DEFAULT_DARK_PALETTE } from "../../types/generated/palette-dark";
import { DEFAULT_LIGHT_PALETTE } from "../../types/generated/palette-light";
import { THEME_COLOR_KEYS } from "../../types/theme-color-keys";
import {
  PREVIEW_COLOR_KEYS,
  previewPaletteFrom,
  themePreviewPalettes,
} from "../theme-preview-palette";

describe("PREVIEW_COLOR_KEYS", () => {
  // 무엇이 이것을 실패시키는가: 시드가 아닌 키(파생 키 · 역할 토큰)를 목록에 넣으면.
  // 파생 키는 테마 패키지가 싣지 않으므로, 레지스트리가 패키지에서 팔레트를 뽑을 때
  // 그 키를 채울 수 없다.
  it("테마가 싣는 시드 키의 부분집합이다", () => {
    const seeds = new Set<string>(THEME_COLOR_KEYS.map((k) => k.key));
    for (const key of PREVIEW_COLOR_KEYS) expect(seeds.has(key)).toBe(true);
  });

  it("중복이 없다", () => {
    expect(new Set(PREVIEW_COLOR_KEYS).size).toBe(PREVIEW_COLOR_KEYS.length);
  });

  // 설정 창이 880px 로 넓어지면서 그림에 더한 요소의 색 — 선택 영역 · 커서 · 파일 트리의
  // git 상태 점 셋. 계약에서 빠지면 그림이 그 요소를 칠할 수 없다.
  it("선택 영역 · 커서 · 상태 색을 싣는다", () => {
    expect(PREVIEW_COLOR_KEYS).toEqual(
      expect.arrayContaining([
        "--color-editor-selection",
        "--color-editor-cursor",
        "--color-status-warning",
        "--color-status-success",
        "--color-status-danger",
      ]),
    );
  });
});

describe("previewPaletteFrom", () => {
  it("미리보기 키만 테마의 값으로 돌려준다", () => {
    const colors = {
      ...DEFAULT_LIGHT_PALETTE,
      "--color-accent-default": "#123456",
    };
    const palette = previewPaletteFrom(colors, "light");
    expect(Object.keys(palette).sort()).toEqual([...PREVIEW_COLOR_KEYS].sort());
    expect(palette["--color-accent-default"]).toBe("#123456");
  });

  // 무엇이 이것을 실패시키는가: 빠진 키를 그대로 두거나(미리보기가 투명해진다) 모드와
  // 무관한 팔레트로 채우면. 적용 경로(`applyThemeVars`)는 빠진 키를 인라인으로 쓰지 않아
  // 그 모드의 CSS 기본값으로 떨어지고, 그 기본값의 출처가 이 생성 팔레트다.
  it.each([
    ["light", DEFAULT_LIGHT_PALETTE],
    ["dark", DEFAULT_DARK_PALETTE],
  ] as const)("빠진 키는 %s 기본 팔레트로 채운다", (mode, base) => {
    const partial: Partial<ThemeColors> = { "--color-editor-bg": "#010203" };
    const palette = previewPaletteFrom(partial, mode);
    expect(palette["--color-editor-bg"]).toBe("#010203");
    expect(palette["--color-bg-panel"]).toBe(base["--color-bg-panel"]);
  });

  it("라이트와 다크 기본값이 실제로 다르다 — 위 테스트가 모드를 가르는지의 전제", () => {
    expect(DEFAULT_LIGHT_PALETTE["--color-bg-panel"]).not.toBe(
      DEFAULT_DARK_PALETTE["--color-bg-panel"],
    );
  });
});

describe("themePreviewPalettes", () => {
  const theme = (modes: ThemeDef["modes"]): ThemeDef => ({
    id: "t",
    modes,
    name: "T",
    source: "custom",
  });

  it("색을 가진 모드마다 팔레트 하나", () => {
    const palettes = themePreviewPalettes(
      theme({
        dark: { colors: DEFAULT_DARK_PALETTE },
        light: { colors: DEFAULT_LIGHT_PALETTE },
      }),
    );
    expect(palettes.light?.["--color-editor-bg"]).toBe(
      DEFAULT_LIGHT_PALETTE["--color-editor-bg"],
    );
    expect(palettes.dark?.["--color-editor-bg"]).toBe(
      DEFAULT_DARK_PALETTE["--color-editor-bg"],
    );
  });

  // CSS 만 싣는 모드(§358)는 그릴 팔레트가 없다 — 기본 팔레트로 채우면 그 테마와
  // 무관한 그림이 그 테마의 미리보기로 보인다.
  it("색이 없는 모드는 빠진다", () => {
    const palettes = themePreviewPalettes(
      theme({
        dark: { css: ".x{}" },
        light: { colors: DEFAULT_LIGHT_PALETTE },
      }),
    );
    expect(palettes.light).toBeDefined();
    expect(palettes.dark).toBeUndefined();
  });
});
