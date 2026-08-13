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

  it("does not render the removed area-highlight toggle or text-highlight hint (§274 UX fix round 2)", () => {
    setup();
    expect(screen.queryByTestId("pdf-area-mode")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("pdf-text-highlight-hint"),
    ).not.toBeInTheDocument();
  });

  it("reports find toggling upward", async () => {
    const props = setup();
    await userEvent.click(screen.getByTestId("pdf-toggle-find"));
    expect(props.onToggleFind).toHaveBeenCalledTimes(1);
  });
});
