// v21 → v22 마이그레이션 핀 — 키 whitelist만이 아니라 **값 계약**까지.
//
// 적대 리뷰 2라운드가 실증한 크래시: v22 이전 import는 무검증이라 저장 테마에
// 숫자·빈 문자열·alpha hex가 남을 수 있고, 키만 거르던 v22는 그 값을 보존했다.
// 활성 테마가 그런 값을 들면 applyThemeVars → derivedVars → parseHexColor에서
// `color.trim is not a function`으로 앱이 시작하다 죽는다. alpha hex는 대비
// 파생을 1:1로 무너뜨린다(#00000000을 불투명 검정으로 계산). 값이 계약에 안
// 맞거나 키가 없으면 테마 base의 기본 팔레트로 되돌아와야 한다.
import { describe, expect, it } from "vitest";

import { defaultColorsForBase } from "../../types/theme";
import { useSettingsStore } from "../settings/store";

type MigratedTheme = { base: string; colors: Record<string, string> };

function migrateThemes(themes: unknown[]): MigratedTheme[] {
  const migrate = useSettingsStore.persist.getOptions().migrate;
  const result = migrate!({ customThemes: themes }, 21) as {
    customThemes: MigratedTheme[];
  };
  return result.customThemes;
}

describe("settings store v21 -> v22 migration (§54 theme value contract)", () => {
  const DARK = defaultColorsForBase("dark");

  it("문자열이 아닌 색 값을 base 기본값으로 되돌린다 (크래시 경로)", () => {
    const [theme] = migrateThemes([
      {
        base: "dark",
        colors: { ...DARK, "--color-accent-default": 123 },
      },
    ]);
    expect(theme.colors["--color-accent-default"]).toBe(
      DARK["--color-accent-default"],
    );
  });

  it("alpha hex를 base 기본값으로 되돌린다 (대비 파생 붕괴 경로)", () => {
    const [theme] = migrateThemes([
      {
        base: "light",
        colors: {
          ...defaultColorsForBase("light"),
          "--color-accent-default": "#00000000",
        },
      },
    ]);
    expect(theme.colors["--color-accent-default"]).toBe(
      defaultColorsForBase("light")["--color-accent-default"],
    );
  });

  it("누락 키를 base 기본값으로 채우고 여분 키를 버린다", () => {
    const [theme] = migrateThemes([
      {
        base: "dark",
        colors: { display: "none", "--color-accent-default": "#123456" },
      },
    ]);
    expect(theme.colors["--color-accent-default"]).toBe("#123456");
    expect(theme.colors["--color-bg-input"]).toBe(DARK["--color-bg-input"]);
    expect("display" in theme.colors).toBe(false);
  });

  it("유효한 팔레트는 그대로 보존한다", () => {
    const [theme] = migrateThemes([{ base: "dark", colors: { ...DARK } }]);
    expect(theme.colors).toEqual(DARK);
  });
});
