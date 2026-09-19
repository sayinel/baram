// 생성된 기본 팔레트의 계약 — 24키 전부가 해석된 불투명 hex여야 한다.
// `{color.blue.500}` 같은 미해석 참조가 남으면 CSS 변수에 그대로 박혀 색이 사라진다.
import { describe, expect, it } from "vitest";

import { DEFAULT_DARK_PALETTE } from "../generated/palette-dark";
import { DEFAULT_LIGHT_PALETTE } from "../generated/palette-light";
import { THEME_COLOR_KEYS, THEME_COLOR_VALUE_RE } from "../theme-color-keys";

const CASES = [
  ["light", DEFAULT_LIGHT_PALETTE],
  ["dark", DEFAULT_DARK_PALETTE],
] as const;

describe("생성된 기본 팔레트", () => {
  for (const [name, palette] of CASES) {
    it(`${name}: THEME_COLOR_KEYS 24키를 정확히 갖는다`, () => {
      expect(Object.keys(palette).sort()).toEqual(
        THEME_COLOR_KEYS.map((k) => k.key).sort(),
      );
    });

    it(`${name}: 모든 값이 해석된 불투명 hex다`, () => {
      for (const { key } of THEME_COLOR_KEYS) {
        expect(palette[key], key).toMatch(THEME_COLOR_VALUE_RE);
      }
    });
  }

  it("라이트와 다크가 서로 다르다 (같은 소스를 두 번 읽는 실수 방지)", () => {
    expect(DEFAULT_LIGHT_PALETTE).not.toEqual(DEFAULT_DARK_PALETTE);
  });
});
