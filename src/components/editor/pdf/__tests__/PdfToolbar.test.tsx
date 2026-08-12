// §274 UX fix (defect 3) — 툴바가 "하이라이트 전체가 꺼져 있다"로 읽히지
// 않는지 고정한다: areaMode 라벨이 이미지/영역으로 한정되고, 텍스트
// 하이라이트용 힌트가 따로 있다.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PdfToolbar } from "../PdfToolbar";

describe("PdfToolbar", () => {
  it("labels the disabled toggle as image/region highlight specifically, not highlighting in general", () => {
    render(
      <PdfToolbar
        areaMode={false}
        currentPage={1}
        onNextPage={vi.fn()}
        onPrevPage={vi.fn()}
        onToggleArea={vi.fn()}
        onToggleFind={vi.fn()}
        pageCount={3}
      />,
    );

    const areaButton = screen.getByTestId("pdf-area-mode");
    expect(areaButton).toBeDisabled();
    expect(areaButton).toHaveAttribute(
      "title",
      "Highlight an image or region (coming soon)",
    );
  });

  it("gives text highlighting its own discoverable hint, separate from the disabled area toggle", () => {
    render(
      <PdfToolbar
        areaMode={false}
        currentPage={1}
        onNextPage={vi.fn()}
        onPrevPage={vi.fn()}
        onToggleArea={vi.fn()}
        onToggleFind={vi.fn()}
        pageCount={3}
      />,
    );

    const hint = screen.getByTestId("pdf-text-highlight-hint");
    expect(hint).toHaveAttribute("title", "Select text to highlight it");
    // 클릭 동작이 없는 정적 힌트라는 것 — button이 아니다.
    expect(hint.tagName).toBe("SPAN");
  });
});
