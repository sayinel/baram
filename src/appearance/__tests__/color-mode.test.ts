// §367 색을 파생하려면 모드를 알아야 한다. `resolveThemeMode` 은 `system` 과
// 모드 없는 테마에서 `undefined` 를 돌려주므로 그 자리에 쓸 수 없다.
import type { ThemeDef } from "../../types/theme";

import { describe, expect, it } from "vitest";

import { resolveColorMode } from "../color-mode";

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
