// §357 모드 해석 — 쌍을 가진 테마는 OS를 따라가고, 하나뿐이면 그 모드로 고정된다.
import type { ThemeDef } from "../theme";

import { describe, expect, it } from "vitest";

import { defaultColorsForBase, resolveThemeMode, themeModes } from "../theme";

function theme(modes: ThemeDef["modes"]): ThemeDef {
  return { id: "t", name: "T", source: "custom", modes };
}

const LIGHT = { colors: defaultColorsForBase("light") };
const DARK = { colors: defaultColorsForBase("dark") };

describe("themeModes", () => {
  it("선언된 모드만 돌려준다", () => {
    expect(themeModes(theme({ light: LIGHT }))).toEqual(["light"]);
    expect(themeModes(theme({ dark: DARK }))).toEqual(["dark"]);
    expect(themeModes(theme({ light: LIGHT, dark: DARK }))).toEqual([
      "light",
      "dark",
    ]);
  });
});

describe("resolveThemeMode", () => {
  it("쌍이면 OS 설정을 따라간다", () => {
    const t = theme({ light: LIGHT, dark: DARK });
    expect(resolveThemeMode(t, true)).toBe("dark");
    expect(resolveThemeMode(t, false)).toBe("light");
  });

  it("하나뿐이면 OS와 무관하게 그 모드다", () => {
    const t = theme({ dark: DARK });
    expect(resolveThemeMode(t, false)).toBe("dark");
    expect(resolveThemeMode(t, true)).toBe("dark");
  });

  it("모드가 없으면 undefined — 호출자가 cascade에 맡긴다", () => {
    expect(resolveThemeMode(theme({}), false)).toBeUndefined();
  });
});
