// src/utils/export/__tests__/export-theme-tokens.test.ts
import { describe, expect, it } from "vitest";

import { BUILT_IN_THEMES } from "../../../types/theme";
import { generateStandaloneHTML } from "../export-html";
import { buildExportStylesheet } from "../export-html-styles";
import { themeTokensBlock } from "../export-theme-tokens";

const tokyo = BUILT_IN_THEMES.find((t) => t.id === "tokyo-night");

describe("themeTokensBlock", () => {
  it("팔레트의 24키와 파생 9키를 :root 블록으로 낸다", () => {
    const css = themeTokensBlock(tokyo, "dark");
    expect(css).toContain("--color-bg-default: #1a1b26");
    // derivedVars 가 따라온다는 것이 스펙 §11 의 `tokens` 정의다.
    // ‼️ `/--color-accent-[a-z-]+:/` 만으로는 이 mutation을 못 잡는다 — tokyo-night의
    // 원본 팔레트에도 `--color-accent-default`/`-hover`/`-subtle`/`-ai` 가 있어 그
    // 정규식이 derivedVars 없이도 매치한다(실측: 뺐더니 초록으로 남았다). 그래서
    // derivedVars 전용 키(`--color-accent-solid`, 원본 24키에는 없다)와 총 키 개수
    // (24+9=33)로 구분한다 — 하나는 derivedVars가 빠지면, 하나는 일부만 빠지면 잡는다.
    expect(css).toContain("--color-accent-solid:");
    expect([...css.matchAll(/^ {2}--color-[a-z-]+: /gmu)]).toHaveLength(33);
    expect(css.startsWith(":root")).toBe(true);
  });

  it("‼️ 실을 팔레트가 없으면 빈 문자열 — system 이 그 경우다 (R3)", () => {
    // "system" 은 BUILT_IN_THEMES 에 없다. findThemeById 가 undefined 를 주고,
    // 그때 tokens 는 default 와 바이트가 같은 출력을 내야 한다.
    expect(themeTokensBlock(undefined, "light")).toBe("");
  });

  it("선언하지 않은 모드를 요구하면 빈 문자열", () => {
    expect(themeTokensBlock(tokyo, "light")).toBe("");
  });
});

describe("themeTokensBlock → generateStandaloneHTML (통합)", () => {
  it("tokens 로 export 하면 활성 테마의 값이 HTML 에 들어 있다", () => {
    const html = generateStandaloneHTML("<p>x</p>", "t", {
      themeTokens: themeTokensBlock(tokyo, "dark"),
    });
    expect(html).toContain("#1a1b26");
    const light = generateStandaloneHTML("<p>x</p>", "t", {});
    expect(light).not.toContain("#1a1b26");
  });

  // ‼️ 위 테스트는 "포함되는가"만 본다 — 문자열 이어붙이기라 순서를 바꿔도 두
  // 블록 다 그대로 들어 있으므로 여전히 통과한다(실측). 커스텀 프로퍼티는
  // *마지막* 선언이 이긴다(브라우저 cascade 규칙)는 것이 buildExportStylesheet의
  // 순서 계약이므로, 그 계약은 텍스트 순서로 따로 고정한다: exportTokensCSS()도
  // `--color-bg-default`를 선언하므로(semantic-light.css), themeTokens 블록이
  // 텍스트상 그 뒤에 와야 실제로 덮어쓴다.
  it("themeTokens 는 exportTokensCSS() 의 같은 키 선언보다 뒤에 온다 — 나중 선언이 이긴다", () => {
    const sheet = buildExportStylesheet("", themeTokensBlock(tokyo, "dark"));
    const semanticIdx = sheet.indexOf("--color-bg-default:");
    const themeIdx = sheet.indexOf("--color-bg-default: #1a1b26");
    expect(semanticIdx).toBeGreaterThan(-1);
    expect(themeIdx).toBeGreaterThan(semanticIdx);
  });

  // Fix round 1, Minor 1 (task-2-review.md) — buildExportStylesheet's doc
  // comment claims "`themeTokens` is empty by default, like `fontFaceCSS`,
  // so every existing caller's output is unaffected", which is really a
  // claim about `.filter((block) => block !== "")` in its body: with both
  // slots empty, the filtered array is unchanged from before this task
  // (base commit), and the join produces no stray blank-line artifact from
  // the two new empty entries. Nothing checked that. Measured what removing
  // the filter actually does (both empty slots survive as extra `\n\n`
  // joins): the sheet gains a leading blank run before `exportTokensCSS()`'s
  // `:root {`, and a 4-newline run where `themeTokens`'s empty slot sits
  // between two joins.
  it("빈 fontFaceCSS/themeTokens 슬롯이 <style> 안에 빈 줄로 남지 않는다 (필터 고정)", () => {
    const sheet = buildExportStylesheet();
    expect(sheet.startsWith(":root")).toBe(true);
    expect(sheet).not.toMatch(/\n{3,}/u);
  });
});
