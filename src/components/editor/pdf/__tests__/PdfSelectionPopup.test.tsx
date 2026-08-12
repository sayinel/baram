// §274 UX fix (defect 1) 회귀 테스트 — 팝업 내부 클릭이 document까지
// 버블돼서는 안 된다. mousedown 쪽은 이미 있던 가드(§274.2)이고, mouseup
// 쪽은 이번에 추가했다: 없으면 스와치 클릭의 mouseup이 document의
// usePdfSelectionPopup 리스너를 건드려, 방금 onPickColor가 닫은 팝업을
// (여전히 non-collapsed인 선택을 다시 읽어) 즉시 재생성해버린다.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PdfSelectionPopup } from "../PdfSelectionPopup";

describe("PdfSelectionPopup", () => {
  it("stops mousedown and mouseup from bubbling past the popup to document", () => {
    render(
      <PdfSelectionPopup
        anchor={{ left: 0, top: 0 }}
        existing={null}
        onCopyRef={vi.fn()}
        onCopyText={vi.fn()}
        onDelete={vi.fn()}
        onPickColor={vi.fn()}
      />,
    );

    const documentMouseDown = vi.fn();
    const documentMouseUp = vi.fn();
    document.addEventListener("mousedown", documentMouseDown);
    document.addEventListener("mouseup", documentMouseUp);

    const swatch = screen.getByTestId("pdf-hl-color-yellow");
    fireEvent.mouseDown(swatch);
    fireEvent.mouseUp(swatch);

    document.removeEventListener("mousedown", documentMouseDown);
    document.removeEventListener("mouseup", documentMouseUp);

    expect(documentMouseDown).not.toHaveBeenCalled();
    expect(documentMouseUp).not.toHaveBeenCalled();
  });

  it("still invokes onPickColor itself when a swatch is clicked", () => {
    const onPickColor = vi.fn();
    render(
      <PdfSelectionPopup
        anchor={{ left: 0, top: 0 }}
        existing={null}
        onCopyRef={vi.fn()}
        onCopyText={vi.fn()}
        onDelete={vi.fn()}
        onPickColor={onPickColor}
      />,
    );

    fireEvent.click(screen.getByTestId("pdf-hl-color-blue"));

    expect(onPickColor).toHaveBeenCalledWith("blue");
  });
});
