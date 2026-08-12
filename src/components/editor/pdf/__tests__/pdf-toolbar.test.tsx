import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PdfToolbar } from "../PdfToolbar";

function setup(overrides: Partial<Parameters<typeof PdfToolbar>[0]> = {}) {
  const props = {
    areaMode: false,
    currentPage: 3,
    onNextPage: vi.fn(),
    onPrevPage: vi.fn(),
    onToggleArea: vi.fn(),
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

  it("reserves the area-highlight slot but keeps it disabled for now", () => {
    setup();
    // §276.3 슬롯은 지금 확보한다 — 2차에 끼워 넣으면 레이아웃을 다시 짜야 한다
    expect(screen.getByTestId("pdf-area-mode")).toBeDisabled();
  });

  it("reports find toggling upward", async () => {
    const props = setup();
    await userEvent.click(screen.getByTestId("pdf-toggle-find"));
    expect(props.onToggleFind).toHaveBeenCalledTimes(1);
  });
});
