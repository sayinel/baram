import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PdfFindBar } from "../PdfFindBar";

const noop = () => {};

function setup(overrides: Partial<Parameters<typeof PdfFindBar>[0]> = {}) {
  const props = {
    currentIdx: 0,
    matchCount: 0,
    onClose: noop,
    onNext: noop,
    onPrev: noop,
    onQueryChange: noop,
    ...overrides,
  };
  render(<PdfFindBar {...props} />);
  return props;
}

describe("PdfFindBar", () => {
  it("reports the query and case-sensitivity upward", async () => {
    const onQueryChange = vi.fn();
    setup({ onQueryChange });

    await userEvent.type(screen.getByRole("searchbox"), "attention");

    expect(onQueryChange).toHaveBeenLastCalledWith("attention", false);
  });

  it("shows a 1-based match position", () => {
    setup({ currentIdx: 2, matchCount: 27 });
    expect(screen.getByText("3 / 27")).toBeInTheDocument();
  });

  it("shows no-results state when the query found nothing", () => {
    setup({ currentIdx: -1, matchCount: 0 });
    expect(screen.getByText("0 / 0")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    setup({ onClose });

    await userEvent.type(screen.getByRole("searchbox"), "{Escape}");

    expect(onClose).toHaveBeenCalled();
  });

  it("moves to the next match on Enter and the previous on Shift+Enter", async () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    setup({ matchCount: 3, onNext, onPrev });

    const input = screen.getByRole("searchbox");
    await userEvent.type(input, "{Enter}");
    expect(onNext).toHaveBeenCalledTimes(1);

    await userEvent.type(input, "{Shift>}{Enter}{/Shift}");
    expect(onPrev).toHaveBeenCalledTimes(1);
  });
});
