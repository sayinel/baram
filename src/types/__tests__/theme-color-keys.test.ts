// 잎 모듈 계약 — 생성기(style-dictionary.config.ts)와 앱이 이 파일을 함께 읽는다.
// 여기에 다른 모듈 import가 추가되면 생성기가 앱 코드를 끌어와 순환이 생긴다.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  fillAliasedColors,
  THEME_COLOR_KEYS,
  THEME_COLOR_VALUE_RE,
} from "../theme-color-keys";

/**
 * 테마 패키지 포맷을 처음 실은 v0.7.4 의 키 목록 — `git show
 * v0.7.4:src/types/theme-color-keys.ts` 에서 순서대로 전사했다. 그 릴리스가 내보낸
 * 패키지·JSON 과 그때 저장된 사용자 테마는 정확히 이 24키를 싣는다.
 */
const KEYS_AT_V0_7_4 = [
  "--color-bg-default",
  "--color-bg-subtle",
  "--color-bg-panel",
  "--color-bg-elevated",
  "--color-bg-input",
  "--color-text-primary",
  "--color-text-secondary",
  "--color-text-disabled",
  "--color-border-default",
  "--color-border-subtle",
  "--color-accent-default",
  "--color-accent-hover",
  "--color-accent-subtle",
  "--color-accent-ai",
  "--color-editor-bg",
  "--color-editor-text",
  "--color-editor-selection",
  "--color-editor-cursor",
  "--color-status-danger",
  "--color-status-warning",
  "--color-status-success",
  "--color-graph-node",
  "--color-graph-active",
  "--color-graph-edge",
];

describe("팔레트보다 늦게 생긴 키", () => {
  it("별칭이 없는 키는 v0.7.4 가 실은 24키 그대로다", () => {
    // 무엇이 이것을 실패시키는가: `aliasOf` 없이 키를 하나 더하면 그 키가 필수가
    // 되고, 그 전에 쓰인 팔레트는 `readModeColors`(theme-install.ts)에서 통째로
    // 버려진다 — 설치는 성공으로 끝나고 팔레트만 사라진다(#722 의 범위 밖 1).
    const required = THEME_COLOR_KEYS.filter((e) => !("aliasOf" in e)).map(
      (e) => e.key,
    );
    expect(required).toEqual(KEYS_AT_V0_7_4);
  });

  it("별칭은 생성된 cascade 가 그 키에 쓰는 값과 같다", () => {
    // 채운 팔레트가 채우기 전과 똑같이 그려지려면, 채우는 값이 그 키가 빠졌을 때
    // cascade 가 그리는 값이어야 한다. 그 값의 출처는 토큰 소스의 별칭이고, 이
    // 배열의 `aliasOf` 는 그것을 한 번 더 적은 것이라 둘이 어긋나면 여기서 잡힌다.
    let checked = 0;
    for (const mode of ["light", "dark"]) {
      const css = readFileSync(
        `src/styles/generated/semantic-${mode}.css`,
        "utf-8",
      );
      for (const entry of THEME_COLOR_KEYS) {
        if (!("aliasOf" in entry)) continue;
        const match = new RegExp(
          `${entry.key}:\\s*var\\(\\s*(--[a-z-]+)\\s*\\)`,
        ).exec(css);
        expect(match?.[1], `${mode}: ${entry.key}`).toBe(entry.aliasOf);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("팔레트에 없는 키를 그 별칭의 값으로 채운다", () => {
    const filled = fillAliasedColors({ "--color-editor-text": "#123abc" });
    expect(filled["--color-editor-guide-tint"]).toBe("#123abc");
  });

  it("팔레트가 이미 실은 값은 덮지 않는다", () => {
    const filled = fillAliasedColors({
      "--color-editor-guide-tint": "#fedcba",
      "--color-editor-text": "#123abc",
    });
    expect(filled["--color-editor-guide-tint"]).toBe("#fedcba");
  });

  it("별칭의 값도 없으면 아무것도 지어내지 않는다", () => {
    const filled = fillAliasedColors({ "--color-bg-default": "#ffffff" });
    expect(filled).not.toHaveProperty("--color-editor-guide-tint");
  });
});

describe("theme-color-keys 잎 모듈", () => {
  it("25키를 갖고 키가 중복되지 않는다", () => {
    const keys = THEME_COLOR_KEYS.map((k) => k.key);
    expect(keys).toHaveLength(25);
    expect(new Set(keys).size).toBe(25);
  });

  it("리스트 가이드 색조를 테마가 실을 수 있는 키로 싣는다", () => {
    // 무엇이 이것을 실패시키는가: 이 키가 배열에 없으면 테마는 가이드 색조에
    // 닿을 길이 전혀 없다. 테마 패키지가 싣는 CSS 는 `sanitize.ts` 가
    // `@layer baram-theme` 로 감싸고 `!important` 를 떼어내므로, 레이어 밖
    // `semantic-*.css` 의 선언을 이길 수 없다. 이 배열만이 `applyThemeVars` 의
    // `<html>` 인라인 경로로 가고, 그 경로만 레이어를 이긴다.
    const guide = THEME_COLOR_KEYS.find(
      (k) => k.key === "--color-editor-guide-tint",
    );
    expect(guide).toBeDefined();
    expect(guide?.category).toBe("Editor");
  });

  it("모든 키가 --color- 접두사를 갖는다", () => {
    for (const { key } of THEME_COLOR_KEYS) {
      expect(key.startsWith("--color-"), key).toBe(true);
    }
  });

  it("불투명 3·6자리 hex만 통과시킨다", () => {
    expect(THEME_COLOR_VALUE_RE.test("#abc")).toBe(true);
    expect(THEME_COLOR_VALUE_RE.test("#aabbcc")).toBe(true);
    expect(THEME_COLOR_VALUE_RE.test("#aabbccdd")).toBe(false);
    expect(THEME_COLOR_VALUE_RE.test("rgb(0,0,0)")).toBe(false);
  });

  it("import 문이 없다 — 생성기가 이 파일만 읽어도 되도록", () => {
    const src = readFileSync("src/types/theme-color-keys.ts", "utf-8");
    expect(src).not.toMatch(/^\s*import\s/m);
  });
});
