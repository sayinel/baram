import type { StoredHighlight } from "../pdf-highlight-sidecar";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { HIGHLIGHT_COLORS } from "../pdf-highlight-sidecar";
import { PdfSelectionPopup } from "../PdfSelectionPopup";

function setup(existing: null | StoredHighlight = null) {
  const props = {
    anchor: { left: 100, top: 200 },
    existing,
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
});
