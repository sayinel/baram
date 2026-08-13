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

  it("offers both Copy reference and Copy text on a fresh selection", () => {
    setup();
    expect(screen.getByTestId("pdf-hl-copy-ref")).toBeInTheDocument();
    expect(screen.getByTestId("pdf-hl-copy-text")).toBeInTheDocument();
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
    it("hides Copy text but keeps Copy reference for a fresh area draft", () => {
      setup(null, "area");
      expect(screen.queryByTestId("pdf-hl-copy-text")).toBeNull();
      expect(screen.getByTestId("pdf-hl-copy-ref")).toBeInTheDocument();
    });

    it("hides Copy text for an existing area highlight too", () => {
      setup({ ...stored, kind: "area" }, "area");
      expect(screen.queryByTestId("pdf-hl-copy-text")).toBeNull();
    });
  });
});
