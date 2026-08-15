import type { StoredHighlight } from "../pdf-highlight-sidecar";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { HIGHLIGHT_COLORS } from "../pdf-highlight-sidecar";
import { PdfSelectionPopup } from "../PdfSelectionPopup";

function setup(
  existing: null | StoredHighlight = null,
  highlightKind: "area" | "text" = "text",
) {
  const props = {
    anchor: { left: 100, top: 200 },
    existing,
    highlightKind,
    onCopyRef: vi.fn(),
    onCopyText: vi.fn(),
    onDelete: vi.fn(),
    onPickColor: vi.fn(),
  };
  render(<PdfSelectionPopup {...props} />);
  return props;
}

const stored: StoredHighlight = {
  color: "yellow",
  id: "h7k2m9",
  kind: "text",
  page: 3,
  rects: [{ h: 12, w: 100, x: 0, y: 0 }],
};

describe("PdfSelectionPopup", () => {
  it("offers every highlight colour", () => {
    setup();
    for (const c of HIGHLIGHT_COLORS) {
      expect(screen.getByTestId(`pdf-hl-color-${c}`)).toBeInTheDocument();
    }
  });

  // §274.2 초안에서는 참조를 복사할 수 없다. 예전에는 가능했고, 그 결과가
  // 사이드카에 대응 항목이 없는 참조였다 — 붙여넣어 Cmd+Click하면 PDF가
  // 아니라 동반 노트가 열렸다(실사용자 보고).
  it("offers Copy text but NOT Copy reference on a fresh selection", () => {
    setup();
    expect(screen.getByTestId("pdf-hl-copy-text")).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-hl-copy-ref")).toBeNull();
  });

  it("offers Copy reference once the highlight exists", () => {
    setup(stored);
    expect(screen.getByTestId("pdf-hl-copy-ref")).toBeInTheDocument();
  });

  it("hides delete for a fresh selection", () => {
    setup();
    expect(screen.queryByTestId("pdf-hl-delete")).toBeNull();
  });

  it("shows delete when an existing highlight is clicked", () => {
    setup(stored);
    expect(screen.getByTestId("pdf-hl-delete")).toBeInTheDocument();
  });

  it("§274 M2: marks the existing highlight's own colour swatch as active", () => {
    // 이 단정이 없으면 array-join으로 클래스를 조립한 이유(prettier가
    // 멀티라인 템플릿 리터럴의 trailing space를 지워 pdf-hl-swatch-yellow와
    // active가 붙어버리는 걸 막으려던 것, PdfSelectionPopup.tsx 참조)가
    // 아무 테스트로도 고정되지 않는다.
    setup(stored); // stored.color === "yellow"

    const activeSwatch = screen.getByTestId("pdf-hl-color-yellow");
    expect(activeSwatch).toHaveClass("active");
    expect(activeSwatch).toHaveAttribute("aria-pressed", "true");

    const inactiveSwatch = screen.getByTestId("pdf-hl-color-green");
    expect(inactiveSwatch).not.toHaveClass("active");
    expect(inactiveSwatch).toHaveAttribute("aria-pressed", "false");
  });

  it("reports the chosen colour upward", async () => {
    const props = setup();
    await userEvent.click(screen.getByTestId("pdf-hl-color-green"));
    expect(props.onPickColor).toHaveBeenCalledWith("green");
  });

  it("reports copy actions upward", async () => {
    const props = setup(stored);
    await userEvent.click(screen.getByTestId("pdf-hl-copy-ref"));
    await userEvent.click(screen.getByTestId("pdf-hl-copy-text"));
    expect(props.onCopyRef).toHaveBeenCalledTimes(1);
    expect(props.onCopyText).toHaveBeenCalledTimes(1);
  });

  // §276.3 — 영역 하이라이트에는 복사할 원문이 없다.
  describe("§276.3 area highlight", () => {
    // 영역 초안에는 남는 액션이 없다 — 원문이 없어 Copy text가 빠지고
    // (§276.3), 하이라이트가 아직 없어 Copy reference도 빠진다(§274.2).
    // 남는 것은 색 스와치뿐이고, 그것이 이 팝업이 초안에서 하는 유일한 일이다.
    it("shows neither copy action for a fresh area draft", () => {
      setup(null, "area");
      expect(screen.queryByTestId("pdf-hl-copy-text")).toBeNull();
      expect(screen.queryByTestId("pdf-hl-copy-ref")).toBeNull();
    });

    it("hides Copy text for an existing area highlight but offers Copy reference", () => {
      setup({ ...stored, kind: "area" }, "area");
      expect(screen.queryByTestId("pdf-hl-copy-text")).toBeNull();
      expect(screen.getByTestId("pdf-hl-copy-ref")).toBeInTheDocument();
    });
  });
});
