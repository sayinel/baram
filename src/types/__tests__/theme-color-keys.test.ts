// 잎 모듈 계약 — 생성기(style-dictionary.config.ts)와 앱이 이 파일을 함께 읽는다.
// 여기에 다른 모듈 import가 추가되면 생성기가 앱 코드를 끌어와 순환이 생긴다.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { THEME_COLOR_KEYS, THEME_COLOR_VALUE_RE } from "../theme-color-keys";

describe("theme-color-keys 잎 모듈", () => {
  it("24키를 갖고 키가 중복되지 않는다", () => {
    const keys = THEME_COLOR_KEYS.map((k) => k.key);
    expect(keys).toHaveLength(24);
    expect(new Set(keys).size).toBe(24);
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
