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
        // vi.fn — 아래 memo 테스트가 "컴포넌트 본문이 다시 돌았는가"를
        // 이 호출 수로 관찰한다(PdfThumbnail이 본문에서 부른다).
        getViewport: vi.fn(({ scale }: { scale: number }) => ({
          height: 792 * scale,
          scale,
          width: 612 * scale,
        })),
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

  // ‼️ 이 목록이 다시 렌더되는 흔한 계기는 스크롤이 아니라 **영역 하이라이트
  // 드래그**다 — use-pdf-area-highlight의 setDragPreview가 rAF 스로틀 없이 raw
  // mousemove마다 새 객체로 state를 세워 PdfPreview 전체를 다시 렌더한다
  // (초당 60~120회+). PdfThumbnail이 memo가 아니면 그때마다 썸네일 N개의 본문이
  // 전부 다시 실행된다. 본문이 돌았는지는 getViewport 호출 수로 관찰한다.
  it("does not re-run its thumbnails when the parent re-renders with the same props", () => {
    const pages = makePages(20);
    const onSelectPage = vi.fn();
    const viewportCalls = () =>
      pages.reduce((n, p) => n + vi.mocked(p.getViewport).mock.calls.length, 0);

    const view = render(
      <PdfPageList currentPage={1} onSelectPage={onSelectPage} pages={pages} />,
    );
    const before = viewportCalls();

    // 같은 참조를 그대로 다시 넘긴다 — 새 인스턴스를 만들면 memo가 정당하게
    // 통과하므로 이 테스트가 아무것도 고정하지 못한다.
    view.rerender(
      <PdfPageList currentPage={1} onSelectPage={onSelectPage} pages={pages} />,
    );

    expect(viewportCalls()).toBe(before);
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
