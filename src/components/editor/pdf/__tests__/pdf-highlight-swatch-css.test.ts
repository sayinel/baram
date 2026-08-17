// §282.2 / 리뷰 I1 — 스와치 색이 실제로 존재하는지 스타일시트에서 확인한다.
//
// 왜 CSS 파일을 읽는가: jsdom은 스타일시트를 로드하지 않아 렌더 테스트로는
// 계산된 배경색을 볼 수 없다. 그런데 이 기능의 첫 판이 정확히 그 구멍으로
// 빠졌다 — 오버레이의 `.pdf-hl-path-*`(fill: 전용, SVG에서만 동작)를 HTML
// span에 붙여 스와치가 전부 투명했고, 구조만 보는 테스트는 전부 초록이었다.
//
// 진짜 위험은 "지금 색이 없다"보다 **다음에 색을 추가할 때**다:
// HIGHLIGHT_COLORS에 색을 하나 더하면 사이드카·오버레이·팝업은 따라오지만
// 이 스와치 규칙은 조용히 빠진다. 그래서 열거를 상수에서 가져와 색마다
// 규칙을 요구한다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { HIGHLIGHT_COLORS } from "../pdf-highlight-sidecar";

const css = readFileSync(
  join(process.cwd(), "src/styles/editor/pdf-side-panel.css"),
  "utf8",
);

const overlayCss = readFileSync(
  join(process.cwd(), "src/styles/editor/pdf.css"),
  "utf8",
);

describe("highlight swatch colours", () => {
  it.each(HIGHLIGHT_COLORS)(
    "gives %s a swatch rule with a background",
    (color) => {
      // 검색 창을 그 규칙 하나로 묶는다 — 파일 어딘가에 background가 있다는
      // 것으로는 이 색이 칠해진다는 증거가 되지 않는다.
      const rule = new RegExp(
        `\\.pdf-highlight-item-swatch-${color}\\s*\\{([^}]*)\\}`,
      );
      const match = rule.exec(css);

      expect(
        match,
        `no .pdf-highlight-item-swatch-${color} rule`,
      ).not.toBeNull();
      expect(match?.[1]).toMatch(/background:\s*var\(--color-editor-pdf-hl-/);
    },
  );

  // 오버레이와 목록이 같은 색을 쓴다는 것이 이 목록의 요점이다 — 토큰이
  // 갈라지면 같은 하이라이트가 두 곳에서 다른 색으로 보인다.
  it.each(HIGHLIGHT_COLORS)(
    "uses the same colour token as the overlay for %s",
    (color) => {
      const rule = new RegExp(
        `\\.pdf-highlight-item-swatch-${color}\\s*\\{([^}]*)\\}`,
      );
      expect(rule.exec(css)?.[1]).toContain(`--color-editor-pdf-hl-${color}`);
    },
  );
});

// §277.2 삭제된 하이라이트는 "채우지 않고 점선 윤곽만"으로 그린다. 그 판정은
// 전부 CSS에 있다 — PdfPage는 클래스 하나를 붙일 뿐이라 jsdom 렌더 테스트는
// 클래스가 붙었다는 것까지만 볼 수 있고, 규칙이 사라져도 초록불이다
// (스와치가 전부 투명했던 §282.2의 그 구멍과 정확히 같은 모양이다).
describe("§277.2 deleted-highlight outline rule", () => {
  const rule = /\.pdf-hl-path\.pdf-hl-path-deleted\s*\{([^}]*)\}/;

  it("exists and turns the fill off", () => {
    const match = rule.exec(overlayCss);
    expect(match, "no .pdf-hl-path.pdf-hl-path-deleted rule").not.toBeNull();
    expect(match?.[1]).toMatch(/fill:\s*none/);
  });

  it("draws a dashed stroke instead", () => {
    const body = rule.exec(overlayCss)?.[1] ?? "";
    expect(body).toMatch(/stroke:/);
    expect(body).toMatch(/stroke-dasharray:/);
  });

  // ‼️ 특이도가 요점이다. `.pdf-hl-path-yellow` 등과 같은 (0,1,0)으로 두면
  // 이 규칙이 파일에서 아래에 있다는 사실에만 기대게 되는데, 그것은 규칙을
  // 옮기는 순간 조용히 깨진다 — 그때 삭제된 하이라이트가 살아 있는 것과
  // 똑같이 칠해진다.
  it("outranks the per-colour fill rules on specificity, not on source order", () => {
    expect(overlayCss).toContain(".pdf-hl-path.pdf-hl-path-deleted");
  });
});
