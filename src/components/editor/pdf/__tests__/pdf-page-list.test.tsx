// §282.1 페이지 목록 — 현재 페이지 표시와 클릭 이동.
import type { PDFPageProxy } from "pdfjs-dist";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PdfPageList } from "../PdfPageList";

function makePages(count: number): PDFPageProxy[] {
  return Array.from(
    { length: count },
    (_, i) =>
      ({
        getViewport: ({ scale }: { scale: number }) => ({
          height: 792 * scale,
          scale,
          width: 612 * scale,
        }),
        pageNumber: i + 1,
        render: () => ({ cancel: vi.fn(), promise: Promise.resolve() }),
      }) as unknown as PDFPageProxy,
  );
}

function setup(overrides: Partial<Parameters<typeof PdfPageList>[0]> = {}) {
  const props = {
    currentPage: 1,
    onSelectPage: vi.fn(),
    pages: makePages(5),
    ...overrides,
  };
  const view = render(<PdfPageList {...props} />);
  return { ...props, view };
}

beforeEach(() => {
  // jsdom에는 scrollIntoView가 없다 — 현재 페이지 추적이 이것을 부른다.
  Element.prototype.scrollIntoView = vi.fn();
});

describe("PdfPageList", () => {
  it("renders one thumbnail per page", () => {
    setup({ pages: makePages(12) });
    expect(screen.getAllByRole("button")).toHaveLength(12);
  });

  it("marks only the current page", () => {
    setup({ currentPage: 3 });
    const marked = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-current") === "true");
    expect(marked).toHaveLength(1);
    expect(marked[0]).toHaveAttribute("data-pdf-thumbnail", "3");
  });

  it("reports the clicked page upward", async () => {
    const props = setup();
    await userEvent.click(
      document.querySelector<HTMLElement>('[data-pdf-thumbnail="4"]')!,
    );
    expect(props.onSelectPage).toHaveBeenCalledWith(4);
  });

  // 본문을 스크롤하면 레일이 따라와야 한다. `block: "nearest"`인 것이 핵심 —
  // 이미 보이는 썸네일에는 아무 일도 하지 않으므로 사용자가 레일을 직접 훑는
  // 동안 그 스크롤을 빼앗지 않는다. "center"였다면 매 페이지마다 레일이 튄다.
  it("keeps the current thumbnail in view without stealing the rail's scroll", () => {
    const { view } = setup({ currentPage: 1 });
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    view.rerender(
      <PdfPageList
        currentPage={9}
        onSelectPage={vi.fn()}
        pages={makePages(12)}
      />,
    );

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
    });
  });

  it("does not scroll when the current page has not moved", () => {
    const { pages, view } = setup({ currentPage: 2 });
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    view.rerender(
      <PdfPageList currentPage={2} onSelectPage={vi.fn()} pages={pages} />,
    );

    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
