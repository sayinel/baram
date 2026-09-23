// §370.2 ChromeReveal의 키보드 복귀 경로 전체가 이 CSS 계약 위에 선다: 숨김은 opacity로만
// 하고 display·visibility로는 하지 않는다는 것(ui.ts §370 주석·chrome-reveal.tsx 헤더
// 주석과 같은 요구). jsdom은 외부 스타일시트를 적용하지 않으므로
// chrome-reveal.test.tsx의 포커스 테스트(`button.focus()` → `document.activeElement`)는
// `.chrome-reveal`이 `opacity: 0`이든 `display: none`이든 똑같이 통과한다 — 나중에
// 누군가 "정리"하며 opacity를 visibility로 바꿔도 그 테스트는 계속 초록불이다. 이
// 파일은 렌더 대신 소스 텍스트를 읽어 규칙 블록 자체를 스캔해서 그 회귀를 잡는다.
//
// ‼️ 이 스캔이 못 잡는 것: 다른 선택자나 다른 CSS 파일이 `.chrome-reveal` 요소에
// display/visibility를 얹는 경우(예: 유틸리티 클래스 조합·인라인 style), 그리고 opacity
// 값 자체가 실제로 숨기는 값인지(예: 기본 규칙의 `opacity: 0`이 실수로 `opacity: 1`로
// 바뀌어도 이 테스트는 "opacity 속성이 있다"까지만 본다 — 렌더 동작은
// chrome-reveal.test.tsx·chrome-reveal-mount-gate.test.tsx가 커버한다).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LAYOUT_CSS = readFileSync(
  path.join(process.cwd(), "src/styles/layout.css"),
  "utf8",
);

/** `.chrome-reveal`을 셀렉터로 포함하는 모든 규칙 블록의 본문을 이어붙인다 — 기본
 *  상태(opacity: 0)와 `:hover`/`:focus-visible` 상태(opacity: 1) 둘 다 포함한다. */
function chromeRevealRuleBodies(): string {
  const bodies: string[] = [];
  const blockRe = /([^{}]+)\{([^}]*)\}/g;
  for (const m of LAYOUT_CSS.matchAll(blockRe)) {
    const [, selector, body] = m;
    if (selector.includes(".chrome-reveal")) bodies.push(body);
  }
  return bodies.join("\n");
}

describe("§370.2 .chrome-reveal CSS contract", () => {
  const combined = chromeRevealRuleBodies();

  it("found at least one .chrome-reveal rule block — otherwise the checks below are vacuous", () => {
    expect(combined.length).toBeGreaterThan(0);
  });

  it("hides/reveals via opacity", () => {
    expect(combined).toMatch(/opacity\s*:/);
  });

  it("never uses display anywhere in its rule blocks", () => {
    expect(combined).not.toMatch(/display\s*:/);
  });

  it("never uses visibility anywhere in its rule blocks", () => {
    expect(combined).not.toMatch(/visibility\s*:/);
  });
});
