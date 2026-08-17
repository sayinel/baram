// §282.1 페이지 목록 — 현재 페이지 표시와 클릭 이동.
import type { PDFPageProxy } from "pdfjs-dist";

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PdfPageRetention } from "../pdf-page-retention";
import { PdfPageList } from "../PdfPageList";

function makePages(count: number): PDFPageProxy[] {
  return Array.from(
    { length: count },
    (_, i) =>
      ({
        cleanup: vi.fn(() => true),
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
    retention,
    ...overrides,
  };
  const view = render(<PdfPageList {...props} />);
  return { ...props, view };
}

// §282.3 렌더 캐시 보관 레지스트리 — 테스트마다 새로 만든다. **한 테스트 안에서는
// 같은 인스턴스**여야 한다: memo/effect deps 테스트가 리렌더 사이에 prop 신원이
// 유지된다는 전제 위에 서 있어서, 렌더할 때마다 새로 만들면 그 테스트들이
// 아무것도 고정하지 못한 채 통과한다.
let retention: PdfPageRetention;
beforeEach(() => {
  retention = new PdfPageRetention();
});

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
        retention={retention}
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
      <PdfPageList
        currentPage={1}
        onSelectPage={onSelectPage}
        pages={pages}
        retention={retention}
      />,
    );
    const before = viewportCalls();

    // 같은 참조를 그대로 다시 넘긴다 — 새 인스턴스를 만들면 memo가 정당하게
    // 통과하므로 이 테스트가 아무것도 고정하지 못한다.
    view.rerender(
      <PdfPageList
        currentPage={1}
        onSelectPage={onSelectPage}
        pages={pages}
        retention={retention}
      />,
    );

    expect(viewportCalls()).toBe(before);
  });

  // §282.4 — 사용자가 실제로 밟은 자리: 마지막 썸네일에서 Tab을 누르니 툴바가
  // 아니라 상태 표시줄로 갔다. 항목이 전부 탭 정지점이면 300페이지 문서에서
  // Tab을 300번 눌러야 레일을 빠져나온다.
  describe("§282.4 roving tabindex", () => {
    it("exposes exactly one tab stop for the whole list", () => {
      setup({ pages: makePages(30) });
      const stops = screen
        .getAllByRole("button")
        .filter((b) => b.getAttribute("tabindex") === "0");
      expect(stops).toHaveLength(1);
    });

    // Tab으로 레일에 들어가면 지금 보고 있는 페이지에서 시작해야 한다 —
    // 1페이지에서 시작하면 300페이지 문서에서 아무 쓸모가 없다.
    it("puts the tab stop on the page the reader is looking at", () => {
      setup({ currentPage: 12, pages: makePages(30) });
      const stop = screen
        .getAllByRole("button")
        .find((b) => b.getAttribute("tabindex") === "0");
      expect(stop).toHaveAttribute("data-pdf-thumbnail", "12");
    });

    it("moves the tab stop with the arrow keys", async () => {
      setup({ currentPage: 5, pages: makePages(30) });
      const list = document.querySelector<HTMLElement>(".pdf-page-list")!;

      await userEvent.click(
        document.querySelector<HTMLElement>('[data-pdf-thumbnail="5"]')!,
      );
      fireEvent.keyDown(list, { key: "ArrowDown" });

      const stop = screen
        .getAllByRole("button")
        .find((b) => b.getAttribute("tabindex") === "0");
      expect(stop).toHaveAttribute("data-pdf-thumbnail", "6");
      expect(document.activeElement).toBe(stop);
    });

    it("jumps to the first and last page with Home and End", () => {
      setup({ currentPage: 5, pages: makePages(30) });
      const list = document.querySelector<HTMLElement>(".pdf-page-list")!;

      fireEvent.keyDown(list, { key: "End" });
      expect(document.activeElement).toHaveAttribute(
        "data-pdf-thumbnail",
        "30",
      );

      fireEvent.keyDown(list, { key: "Home" });
      expect(document.activeElement).toHaveAttribute("data-pdf-thumbnail", "1");
    });

    it("stops at the ends instead of wrapping", () => {
      setup({ currentPage: 1, pages: makePages(5) });
      const list = document.querySelector<HTMLElement>(".pdf-page-list")!;

      fireEvent.keyDown(list, { key: "ArrowUp" });

      const stop = screen
        .getAllByRole("button")
        .find((b) => b.getAttribute("tabindex") === "0");
      expect(stop).toHaveAttribute("data-pdf-thumbnail", "1");
    });

    // 화살표를 그대로 두면 레일 본문이 함께 스크롤되어 방금 포커스한 항목이
    // 화면에서 밀려난다.
    it("consumes the arrow key so the rail does not also scroll", () => {
      setup({ pages: makePages(5) });
      const list = document.querySelector<HTMLElement>(".pdf-page-list")!;

      const consumed = !fireEvent.keyDown(list, { key: "ArrowDown" });

      expect(consumed).toBe(true);
    });

    it("leaves other keys alone", () => {
      setup({ pages: makePages(5) });
      const list = document.querySelector<HTMLElement>(".pdf-page-list")!;

      const consumed = !fireEvent.keyDown(list, { key: "a" });

      expect(consumed).toBe(false);
    });
  });

  it("does not scroll when the current page has not moved", () => {
    const { pages, view } = setup({ currentPage: 2 });
    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    view.rerender(
      <PdfPageList
        currentPage={2}
        onSelectPage={vi.fn()}
        pages={pages}
        retention={retention}
      />,
    );

    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
