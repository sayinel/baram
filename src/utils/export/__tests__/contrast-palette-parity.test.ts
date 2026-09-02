// contrast 코드블록 팔레트는 의도적으로 두 벌이다 — 앱은 CSS 컴포넌트 변수
// (styles/editor/code-blocks.css의 --code-contrast-*), standalone export는 JS
// 상수(CODE_STYLE_MAP.contrast; export HTML은 var()를 못 읽는다). 두 사본의
// 계약이 주석으로만 지켜졌고 그 주석마저 한때 없는 심볼을 가리켰다(적대 리뷰)
// — 값을 직접 대조해 계약을 강제한다.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CODE_STYLE_MAP } from "../export-html-styles";

const css = readFileSync(
  resolve(__dirname, "../../../styles/editor/code-blocks.css"),
  "utf-8",
);

function cssVar(name: string): string {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
  expect(m, `${name}이 code-blocks.css에 정의돼 있지 않다`).not.toBeNull();
  return m![1].trim().replace(/\s*\/\*.*$/, "");
}

describe("contrast 팔레트 — 앱 CSS ↔ export 상수 parity", () => {
  const contrast = CODE_STYLE_MAP.contrast;

  it("본문·헤더·gutter의 여섯 슬롯이 같은 값이다", () => {
    expect(contrast.bodyColor).toBe(cssVar("--code-contrast-text"));
    expect(contrast.langColor).toBe(cssVar("--code-contrast-subtext"));
    expect(contrast.gutterColor).toBe(cssVar("--code-contrast-muted"));
    expect(contrast.bodyBg).toBe(cssVar("--code-contrast-bg"));
    expect(contrast.gutterBg).toBe(cssVar("--code-contrast-bg-dim"));
    expect(contrast.bodyBorder).toBe(cssVar("--code-contrast-border"));
  });

  it("교차 참조 주석이 실존 심볼을 가리킨다", () => {
    // 주석이 없는 심볼(CODE_STYLES)을 가리키던 실사례의 재발 방지.
    expect(css).toContain("CODE_STYLE_MAP.contrast");
    expect(css).not.toMatch(/CODE_STYLES\.contrast/);
  });
});
