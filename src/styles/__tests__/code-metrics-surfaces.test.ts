// §354 — 코드 크기·줄 높이를 선언하는 자리는 설정에서 읽어야 한다.
//
// 이 가드가 있는 이유는 §349 가 남긴 교훈 그대로다. 그때의 결함은 설정이
// **요소 하나의 인라인 스타일**로만 걸려서, 제 크기를 따로 선언하는 자리들에는
// 닿지 않는 것이었다 — 그래서 "코드 서체"라는 설정이 존재할 수 없었다. 크기도
// 같은 모양의 결함을 가질 수 있다: 어느 한 자리가 `0.875em` 같은 상수로 돌아가면
// 그 표면만 설정을 무시하고, 화면은 조용히 어긋난 채 모든 테스트가 초록이다.
//
// jsdom 은 var() 치환도 em 계산도 하지 않으므로 렌더로는 물을 수 없다. 물을 수
// 있는 것은 선언이다: 코드의 크기를 정하는 규칙이 변수를 읽고 있는가.
import { describe, expect, it } from "vitest";

import { cssDeclarations, cssRules } from "./css-rules";

/**
 * 코드의 글자 크기를 정하는 규칙들. 열거이므로 새 코드 표면은 자동으로 들어오지
 * 않는다 — 그 한계를 아는 채로 열거한다. 열거하지 않는 대안(모든 `font-size`
 * 선언을 훑어 `em` 상수를 금지)은 본문 쪽 제목·인용 등 정당한 `em` 을 전부
 * 걸어서, 가드가 아니라 소음이 된다.
 */
const CODE_SIZE_RULES = [
  ".tiptap code",
  ".code-block-editor .cm-editor",
  ".code-block-placeholder",
];

const RULES = cssRules();

function declarationsFor(selector: string, prop: string): string[] {
  return RULES.filter((rule) => rule.selector === selector).flatMap((rule) =>
    cssDeclarations(rule.body)
      .filter((d) => d.prop === prop)
      .map((d) => d.value),
  );
}

describe("§354 code size follows the setting", () => {
  it.each(CODE_SIZE_RULES)("%s reads the size variable", (selector) => {
    const sizes = declarationsFor(selector, "font-size");
    expect(sizes.length).toBeGreaterThan(0);
    for (const value of sizes) {
      expect(value).toContain("var(--editor-code-font-size");
    }
  });

  // 폴백이 곧 "설정이 생기기 전의 값" 이다 — 효과가 돌기 전(첫 페인트, 그리고
  // 이 변수가 걸리지 않는 표면)에도 스타일시트 혼자 예전과 같은 그림을 그린다.
  it.each(CODE_SIZE_RULES)("%s falls back to the old constant", (selector) => {
    for (const value of declarationsFor(selector, "font-size")) {
      expect(value).toMatch(/var\(--editor-code-font-size,\s*0\.875em\)/u);
    }
  });

  // 줄 높이는 블록에만 건다. 인라인 코드에 줄 높이를 주면 그 조각 하나 때문에
  // 본문 한 줄의 높이가 달라져, 설정과 무관하게 문단이 들쭉날쭉해진다.
  it("does not give inline code a line height of its own", () => {
    expect(declarationsFor(".tiptap code", "line-height")).toEqual([]);
  });

  it.each([".code-block-editor .cm-editor", ".code-block-placeholder"])(
    "%s reads the line-height variable",
    (selector) => {
      const values = declarationsFor(selector, "line-height");
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) {
        expect(value).toContain("var(--editor-code-line-height");
      }
    },
  );
});
