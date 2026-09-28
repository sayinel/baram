// §360 · §371 — `parseThemeTokens`: 설치 경로와 게시 경로가 함께 부르는 토큰 → 색 규칙.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { THEME_COLOR_KEYS } from "../../types/theme";
import { parseThemeTokens } from "../theme-tokens";

const reference = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../examples/themes/hangul/light/tokens.json"),
    "utf8",
  ),
) as Record<string, string>;

describe("parseThemeTokens", () => {
  it("화이트리스트 키만으로 다시 짓는다 — 끼어든 키는 남지 않는다", () => {
    const result = parseThemeTokens({
      ...reference,
      "--color-injected": "#000000",
      color: "red",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.colors).sort()).toEqual(
      THEME_COLOR_KEYS.map((entry) => entry.key).sort(),
    );
  });

  it("포맷보다 늦게 생긴 키는 같은 팔레트의 별칭 값으로 채운다", () => {
    expect(reference).not.toHaveProperty("--color-editor-guide-tint");
    const result = parseThemeTokens(reference);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.colors["--color-editor-guide-tint"]).toBe(
      reference["--color-editor-text"],
    );
  });

  it("빠진 시드 키를 짚는다", () => {
    const partial = { ...reference };
    delete partial["--color-status-warning"];
    expect(parseThemeTokens(partial)).toEqual({
      key: "--color-status-warning",
      ok: false,
    });
  });

  it("형식이 틀린 값을 짚는다", () => {
    expect(
      parseThemeTokens({ ...reference, "--color-bg-default": "red" }),
    ).toEqual({ key: "--color-bg-default", ok: false });
  });

  it.each([[null], [[]], ["#fff"]])(
    "평범한 객체가 아닌 %j 는 key 없이 실패한다",
    (value) => {
      expect(parseThemeTokens(value)).toEqual({ key: null, ok: false });
    },
  );
});
