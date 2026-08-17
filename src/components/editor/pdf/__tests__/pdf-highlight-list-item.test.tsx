// §282.2 목록 한 줄 — 영역 크롭의 지연 렌더와 해상도 예산.
import type { StoredHighlight } from "../pdf-highlight-sidecar";
import type { PDFPageProxy } from "pdfjs-dist";

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PdfPageRetention } from "../pdf-page-retention";
import { PdfHighlightListItem } from "../PdfHighlightListItem";

interface MockIO {
  triggerIntersect: (isIntersecting?: boolean) => void;
}

function observers(): MockIO[] {
  return (
    globalThis as unknown as {
      MockIntersectionObserver: { instances: MockIO[] };
    }
  ).MockIntersectionObserver.instances;
}

const renderCalls = vi.fn();
const cancelCalls = vi.fn();

/** 200×100pt 영역 — 폭이 크롭 표시 폭(150)보다 커서 축소가 걸린다. */
function areaHighlight(): StoredHighlight {
  return {
    color: "yellow",
    id: "area-1",
    kind: "area",
    page: 1,
    rects: [{ h: 100, w: 200, x: 50, y: 400 }],
  };
}

function makePage(): PDFPageProxy {
  return {
    cleanup: vi.fn(() => true),
    getViewport: ({ scale }: { scale: number }) => ({
      convertToPdfPoint: (x: number, y: number) => [x, y],
      convertToViewportPoint: (x: number, y: number) => [x, y],
      height: 792 * scale,
      scale,
      width: 612 * scale,
    }),
    pageNumber: 1,
    render: (args: unknown) => {
      renderCalls(args);
      return { cancel: cancelCalls, promise: Promise.resolve() };
    },
  } as unknown as PDFPageProxy;
}

function setup(
  overrides: Partial<Parameters<typeof PdfHighlightListItem>[0]> = {},
) {
  const props = {
    isDeleted: false,
    isFlashing: false,
    item: { highlight: areaHighlight(), text: null },
    onSelect: vi.fn(),
    page: makePage(),
    pageLabel: "p. 1",
    retention,
    tabIndex: 0,
    ...overrides,
  };
  const view = render(<PdfHighlightListItem {...props} />);
  return { ...props, view };
}

function textHighlight(): StoredHighlight {
  return {
    color: "green",
    id: "text-1",
    kind: "text",
    page: 1,
    rects: [{ h: 10, w: 300, x: 0, y: 700 }],
  };
}

// §282.3 렌더 캐시 보관 레지스트리 — 테스트마다 새로 만든다. **한 테스트 안에서는
// 같은 인스턴스**여야 한다: 아래 memo 테스트가 리렌더 사이에 prop 신원이
// 유지된다는 전제 위에 서 있어서, 렌더할 때마다 새로 만들면 그 테스트가
// 아무것도 고정하지 못한 채 통과한다.
let retention: PdfPageRetention;

beforeEach(() => {
  retention = new PdfPageRetention();
  observers().length = 0;
  renderCalls.mockClear();
  cancelCalls.mockClear();
  vi.stubGlobal("devicePixelRatio", 2);
});

describe("PdfHighlightListItem", () => {
  it("does not draw the crop before the row is in view", () => {
    setup();
    expect(renderCalls).not.toHaveBeenCalled();
  });

  it("draws the crop once the row comes into view", () => {
    setup();
    act(() => {
      observers()[0].triggerIntersect(true);
    });
    expect(renderCalls).toHaveBeenCalledTimes(1);
  });

  it("cancels the crop render when the row scrolls away", () => {
    setup();
    act(() => {
      observers()[0].triggerIntersect(true);
    });
    act(() => {
      observers()[0].triggerIntersect(false);
    });
    expect(cancelCalls).toHaveBeenCalled();
  });

  // 텍스트 하이라이트의 rect들은 줄마다 흩어져 있어 그 상자를 잘라내면
  // 무의미한 띠가 나온다 — 원문이 곧 그 줄의 내용이다.
  it("does not draw a crop for a text highlight", () => {
    setup({ item: { highlight: textHighlight(), text: "quoted line" } });
    act(() => {
      observers()[0].triggerIntersect(true);
    });
    expect(renderCalls).not.toHaveBeenCalled();
    expect(document.querySelector(".pdf-highlight-item-crop")).toBeNull();
  });

  // ‼️ §276.6의 기본 백킹 목표(900 CSS px)는 노트에 박힌 참조가 리사이즈로
  // 커질 수 있어서다. 레일은 폭이 고정이라 그 전제가 없다 — 기본값을 쓰면
  // 150px 자리에 6배 폭(=36배 픽셀)을 그린다.
  it("sizes the crop backing to the rail, not to the note-embed target", () => {
    setup();
    act(() => {
      observers()[0].triggerIntersect(true);
    });
    const canvas = document.querySelector<HTMLCanvasElement>("canvas");
    // 200pt 폭을 150 CSS px 목표 × dpr 2 = 300 device px로 그린다.
    expect(canvas?.width).toBe(300);
  });

  // computeAreaCropLayout은 매번 새 객체를 돌려준다 — deps에 그대로 넣으면
  // 리렌더마다 cancel → 재렌더가 반복된다(그림 깜빡임 + 워커 부하).
  it("does not redraw the crop on an unrelated re-render", () => {
    // ‼️ page와 item은 **같은 참조**를 다시 넘겨야 한다. 새 인스턴스를 넘기면
    // useMemo가 정당하게 다시 계산하므로, 메모가 없어도 이 테스트가 통과해
    // 아무것도 고정하지 못한다.
    const { item, page, view } = setup();
    act(() => {
      observers()[0].triggerIntersect(true);
    });
    expect(renderCalls).toHaveBeenCalledTimes(1);

    view.rerender(
      <PdfHighlightListItem
        isDeleted={false}
        isFlashing
        item={item}
        onSelect={vi.fn()}
        page={page}
        pageLabel="p. 1"
        retention={retention}
        tabIndex={0}
      />,
    );

    expect(renderCalls).toHaveBeenCalledTimes(1);
  });

  it("renders the companion text when there is some", () => {
    setup({ item: { highlight: textHighlight(), text: "attention is all" } });
    expect(screen.getByText("attention is all")).toBeInTheDocument();
  });

  // 그림 위의 영역 하이라이트는 그 아래 텍스트가 없어 문단이 비어 있다 —
  // 빈 span을 그리면 줄 높이만 차지하는 유령 요소가 된다.
  it("renders no text element when the companion paragraph is empty", () => {
    setup({ item: { highlight: areaHighlight(), text: null } });
    expect(document.querySelector(".pdf-highlight-item-text")).toBeNull();
  });

  // ‼️ 리뷰 I1. 첫 판은 오버레이의 `.pdf-hl-path-*`를 스와치에 그대로 붙였는데,
  // 그 규칙은 `fill:`만 세우고 fill은 **SVG 전용**이라 HTML span에서는 아무
  // 효과가 없었다 — 모든 줄의 스와치가 투명했고, 색이 곧 요점인 목록에서 색이
  // 사라져 있었다. jsdom은 CSS 파일을 로드하지 않으므로 계산된 배경색은 볼 수
  // 없다. 대신 "SVG 전용 클래스에 기대지 않는다"를 클래스 이름으로 고정한다.
  it("does not paint the swatch with the SVG-only overlay class", () => {
    setup({ item: { highlight: textHighlight(), text: "x" } });
    const swatch = document.querySelector(".pdf-highlight-item-swatch");

    expect(swatch).not.toBeNull();
    expect(swatch?.className).not.toMatch(/\bpdf-hl-path-/);
    expect(swatch?.className).toContain("pdf-highlight-item-swatch-green");
  });

  it("names the swatch class after the highlight's own colour", () => {
    setup({ item: { highlight: areaHighlight(), text: null } });
    expect(
      document.querySelector(".pdf-highlight-item-swatch-yellow"),
    ).not.toBeNull();
  });

  it("reports the highlight id when clicked", () => {
    const props = setup();
    screen.getByRole("button").click();
    expect(props.onSelect).toHaveBeenCalledWith("area-1");
  });
});

// §282.3 렌더 캐시 보관 배선 — 영역 크롭도 같은 프록시를 그린다.
describe("§282.3 PdfHighlightListItem render-cache retention", () => {
  /** 축출은 마이크로태스크로 미뤄진다 — 단정 전에 흘려준다. */
  async function settle(): Promise<void> {
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
  }

  it("frees the page's render cache when the row scrolls out of view", async () => {
    const page = makePage();
    setup({ page, retention: new PdfPageRetention(0) });
    act(() => {
      observers()[0].triggerIntersect(true);
    });
    await settle();
    expect(page.cleanup).not.toHaveBeenCalled();

    act(() => {
      observers()[0].triggerIntersect(false);
    });
    await settle();
    expect(page.cleanup).toHaveBeenCalledTimes(1);
  });

  // ‼️ 순서가 계약이다 — PdfPage의 같은 이름 테스트 주석 참조. `cleanup()` 시점으로는
  // 볼 수 없다(축출이 마이크로태스크로 밀려 어느 쪽이든 항상 나중이라 단정이 언제나
  // 참이 된다). **release 자체**의 호출 시점을 봐야 한다.
  it("cancels the in-flight crop render before releasing the cache", () => {
    const page = makePage();
    const retention = new PdfPageRetention(0);
    const releaseCalled = vi.fn();
    const realRetain = retention.retain.bind(retention);
    vi.spyOn(retention, "retain").mockImplementation((p) => {
      const release = realRetain(p);
      return () => {
        releaseCalled();
        release();
      };
    });
    setup({ page, retention });

    act(() => {
      observers()[0].triggerIntersect(true);
    });
    act(() => {
      observers()[0].triggerIntersect(false);
    });

    expect(cancelCalls).toHaveBeenCalled();
    expect(releaseCalled).toHaveBeenCalled();
    expect(cancelCalls.mock.invocationCallOrder[0]).toBeLessThan(
      releaseCalled.mock.invocationCallOrder[0],
    );
  });

  // 본문이 같은 페이지를 띄워 두고 있으면 크롭이 스크롤로 사라져도 비우지 않는다.
  it("leaves the cache alone while the main view still holds the page", async () => {
    const page = makePage();
    const retention = new PdfPageRetention(0);
    const releaseMainView = retention.retain(page);
    setup({ page, retention });

    act(() => {
      observers()[0].triggerIntersect(true);
    });
    act(() => {
      observers()[0].triggerIntersect(false);
    });
    await settle();
    expect(page.cleanup).not.toHaveBeenCalled();

    releaseMainView();
    await settle();
    expect(page.cleanup).toHaveBeenCalledTimes(1);
  });
});
