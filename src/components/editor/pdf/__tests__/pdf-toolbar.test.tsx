import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PdfToolbar } from "../PdfToolbar";

function setup(overrides: Partial<Parameters<typeof PdfToolbar>[0]> = {}) {
  const props = {
    currentPage: 3,
    onNextPage: vi.fn(),
    onPrevPage: vi.fn(),
    onToggleFind: vi.fn(),
    pageCount: 27,
    ...overrides,
  };
  render(<PdfToolbar {...props} />);
  return props;
}

describe("PdfToolbar", () => {
  it("shows the current page against the total", () => {
    setup();
    expect(screen.getByText("3 / 27")).toBeInTheDocument();
  });

  it("disables previous on the first page", () => {
    setup({ currentPage: 1 });
    expect(screen.getByTestId("pdf-prev-page")).toBeDisabled();
    expect(screen.getByTestId("pdf-next-page")).toBeEnabled();
  });

  it("disables next on the last page", () => {
    setup({ currentPage: 27, pageCount: 27 });
    expect(screen.getByTestId("pdf-next-page")).toBeDisabled();
  });

  // §274 UX fix round 2 removed a hint element that no longer exists at all
  // — pinned so a stray re-add is caught.
  it("has no leftover text-highlight hint element", () => {
    setup();
    expect(
      screen.queryByTestId("pdf-text-highlight-hint"),
    ).not.toBeInTheDocument();
  });

  it("reports find toggling upward", async () => {
    const props = setup();
    await userEvent.click(screen.getByTestId("pdf-toggle-find"));
    expect(props.onToggleFind).toHaveBeenCalledTimes(1);
  });

  // §276.3 — the area-mode toggle is back, this time functional: no
  // onToggleAreaMode means it's not offered at all (vault-less PDFs),
  // matching the "no disabled-looking control" lesson round 2 encoded.
  describe("§276.3 area-mode toggle", () => {
    it("hides the toggle when onToggleAreaMode is not provided", () => {
      setup();
      expect(screen.queryByTestId("pdf-area-mode")).not.toBeInTheDocument();
    });

    it("renders the toggle with aria-pressed reflecting areaMode", () => {
      setup({ areaMode: true, onToggleAreaMode: vi.fn() });
      expect(screen.getByTestId("pdf-area-mode")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("defaults aria-pressed to false when areaMode is omitted", () => {
      setup({ onToggleAreaMode: vi.fn() });
      expect(screen.getByTestId("pdf-area-mode")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("reports the toggle click upward", async () => {
      const onToggleAreaMode = vi.fn();
      setup({ onToggleAreaMode });
      await userEvent.click(screen.getByTestId("pdf-area-mode"));
      expect(onToggleAreaMode).toHaveBeenCalledTimes(1);
    });
  });

  // §276.3.1 — text highlighting reverses course and becomes a mode too
  // (user override of the original §276.3 "selection is the entry point"
  // design). Same shape as the area toggle, on purpose — the two are
  // mutually exclusive siblings, not a special case of each other.
  describe("§276.3.1 text-mode toggle", () => {
    it("hides the toggle when onToggleTextMode is not provided", () => {
      setup();
      expect(screen.queryByTestId("pdf-text-mode")).not.toBeInTheDocument();
    });

    it("renders the toggle with aria-pressed reflecting textMode", () => {
      setup({ onToggleTextMode: vi.fn(), textMode: true });
      expect(screen.getByTestId("pdf-text-mode")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("defaults aria-pressed to false when textMode is omitted", () => {
      setup({ onToggleTextMode: vi.fn() });
      expect(screen.getByTestId("pdf-text-mode")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("reports the toggle click upward", async () => {
      const onToggleTextMode = vi.fn();
      setup({ onToggleTextMode });
      await userEvent.click(screen.getByTestId("pdf-text-mode"));
      expect(onToggleTextMode).toHaveBeenCalledTimes(1);
    });

    it("can render both toggles side by side, independently pressed", () => {
      setup({
        areaMode: false,
        onToggleAreaMode: vi.fn(),
        onToggleTextMode: vi.fn(),
        textMode: true,
      });
      expect(screen.getByTestId("pdf-text-mode")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByTestId("pdf-area-mode")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });
  });
});
