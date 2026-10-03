// §367 색을 파생하려면 모드를 알아야 한다. `resolveThemeMode` 은 `system` 과
// 모드 없는 테마에서 `undefined` 를 돌려주므로 그 자리에 쓸 수 없다.
import type { ThemeDef } from "../../types/theme";

import { describe, expect, it } from "vitest";

import {
  appliedThemeMode,
  followsColorModeSetting,
  prefersDarkFor,
  resolveColorMode,
} from "../color-mode";

const LIGHT_ONLY: ThemeDef = {
  id: "l",
  modes: { light: { css: "x{}" } },
  name: "L",
  source: "custom",
};
const DARK_ONLY: ThemeDef = {
  id: "d",
  modes: { dark: { css: "x{}" } },
  name: "D",
  source: "custom",
};
const PAIRED: ThemeDef = {
  id: "p",
  modes: { dark: { css: "x{}" }, light: { css: "x{}" } },
  name: "P",
  source: "custom",
};

describe("resolveColorMode", () => {
  // 무엇이 이것을 실패시키는가: `resolveThemeMode` 을 그대로 재export 하면
  // `undefined` 가 새어 나와 파생 엔진이 시드를 어느 모드로 읽을지 모른다.
  it("테마가 없으면 OS 선호를 따른다", () => {
    expect(resolveColorMode(undefined, true)).toBe("dark");
    expect(resolveColorMode(undefined, false)).toBe("light");
  });

  it("한 모드짜리 테마는 OS 와 무관하게 그 모드다", () => {
    expect(resolveColorMode(LIGHT_ONLY, true)).toBe("light");
    expect(resolveColorMode(DARK_ONLY, false)).toBe("dark");
  });

  it("쌍을 가진 테마는 OS 를 따른다", () => {
    expect(resolveColorMode(PAIRED, true)).toBe("dark");
    expect(resolveColorMode(PAIRED, false)).toBe("light");
  });

  // 비공허성: 위 셋은 구현이 `prefersDark ? "dark" : "light"` 한 줄이어도
  // 두 개가 통과한다. 이것이 그 구현을 배제한다 — 한 모드짜리 테마는
  // OS 를 **무시**해야 하고, 그 갈래가 `resolveThemeMode` 을 쓰는 이유다.
  it("모드 선언이 하나도 없는 테마는 OS 선호로 떨어진다", () => {
    const EMPTY = {
      id: "e",
      modes: {},
      name: "E",
      source: "custom",
    } as ThemeDef;
    expect(resolveColorMode(EMPTY, true)).toBe("dark");
    expect(resolveColorMode(EMPTY, false)).toBe("light");
  });
});

// §386 모드 설정(스펙 0064). 아래 셋은 "앱이 OS 대신 무엇을 읽는가" 의 한 집이다.
const NO_MODES: ThemeDef = { id: "n", modes: {}, name: "N", source: "custom" };

describe("prefersDarkFor (§386)", () => {
  it("시스템이면 OS 를 그대로 따른다", () => {
    expect(prefersDarkFor("system", true)).toBe(true);
    expect(prefersDarkFor("system", false)).toBe(false);
  });

  // 무엇이 이것을 실패시키는가: 고정값을 무시하고 OS 를 돌려주는 구현.
  it("고정이면 OS 를 무시한다", () => {
    expect(prefersDarkFor("dark", false)).toBe(true);
    expect(prefersDarkFor("light", true)).toBe(false);
  });
});

describe("appliedThemeMode (§386)", () => {
  // 무엇이 이것을 실패시키는가:
  // - 테마가 없을 때 설정을 무시하는 구현(오늘의 `use-settings-effects.ts` 규칙) → 고정 행 둘
  // - 한 모드 테마에 설정을 밀어 넣는 구현 → LIGHT_ONLY · DARK_ONLY 행(스펙 D4)
  // - 시스템인데도 모드를 넣는 구현 → 첫 두 행(스펙 D7 — 첫 페인트를 미디어 쿼리가 그린다)
  it.each([
    ["system/미해석 · 시스템 · OS 다크", undefined, "system", true, undefined],
    [
      "system/미해석 · 시스템 · OS 라이트",
      undefined,
      "system",
      false,
      undefined,
    ],
    ["system/미해석 · 다크 고정 · OS 라이트", undefined, "dark", false, "dark"],
    [
      "system/미해석 · 라이트 고정 · OS 다크",
      undefined,
      "light",
      true,
      "light",
    ],
    ["두 모드 · 시스템 · OS 다크", PAIRED, "system", true, "dark"],
    ["두 모드 · 시스템 · OS 라이트", PAIRED, "system", false, "light"],
    ["두 모드 · 다크 고정 · OS 라이트", PAIRED, "dark", false, "dark"],
    ["두 모드 · 라이트 고정 · OS 다크", PAIRED, "light", true, "light"],
    ["라이트 전용 · 다크 고정", LIGHT_ONLY, "dark", true, "light"],
    ["다크 전용 · 라이트 고정", DARK_ONLY, "light", false, "dark"],
    ["모드 없음 · 시스템", NO_MODES, "system", true, undefined],
    ["모드 없음 · 다크 고정", NO_MODES, "dark", false, "dark"],
  ] as const)("%s", (_name, theme, setting, os, expected) => {
    expect(appliedThemeMode(theme, setting, os)).toBe(expected);
  });
});

describe("followsColorModeSetting (§386)", () => {
  it("한 모드짜리 테마만 따르지 않는다", () => {
    expect(followsColorModeSetting(undefined)).toBe(true);
    expect(followsColorModeSetting(PAIRED)).toBe(true);
    expect(followsColorModeSetting(NO_MODES)).toBe(true);
    expect(followsColorModeSetting(LIGHT_ONLY)).toBe(false);
    expect(followsColorModeSetting(DARK_ONLY)).toBe(false);
  });
});
