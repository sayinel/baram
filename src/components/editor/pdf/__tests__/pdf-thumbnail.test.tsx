// §282.1 썸네일 — 지연 렌더와 종횡비.
import type { PDFPageProxy } from "pdfjs-dist";

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PdfPageRetention } from "../pdf-page-retention";
import { PdfThumbnail } from "../PdfThumbnail";

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

/** US Letter 세로(612×792pt) — 종횡비가 1이 아니라서 폭/높이 혼동을 잡는다. */
function makePage(pageNumber = 1): PDFPageProxy {
  return {
    cleanup: vi.fn(() => true),
    getViewport: ({ scale }: { scale: number }) => ({
      height: 792 * scale,
      scale,
      width: 612 * scale,
    }),
    pageNumber,
    render: (args: unknown) => {
      renderCalls(args);
      return { cancel: cancelCalls, promise: Promise.resolve() };
    },
  } as unknown as PDFPageProxy;
}

function setup(overrides: Partial<Parameters<typeof PdfThumbnail>[0]> = {}) {
  const props = {
    isCurrent: false,
    label: "Page 1",
    onSelect: vi.fn(),
    page: makePage(),
    renderWidth: 150,
    retention,
    tabIndex: 0,
    width: 150,
    ...overrides,
  };
  const view = render(<PdfThumbnail {...props} />);
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
  observers().length = 0;
  renderCalls.mockClear();
  cancelCalls.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PdfThumbnail", () => {
  // 300페이지 문서의 썸네일을 전부 그려 두면 dpr 2에서 ~368MB다. 지연 렌더가
  // 그 상한을 만드는 유일한 장치라 "보이기 전에는 그리지 않는다"가 성능 취향이
  // 아니라 메모리 계약이다.
  it("does not render before the thumbnail is in view", () => {
    setup();
    expect(renderCalls).not.toHaveBeenCalled();
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("renders once the thumbnail comes into view", () => {
    setup();
    act(() => {
      observers()[0].triggerIntersect(true);
    });
    expect(renderCalls).toHaveBeenCalledTimes(1);
    expect(document.querySelector("canvas")).not.toBeNull();
  });

  // 상한의 나머지 절반 — 들어올 때만 그리고 나갈 때 놓지 않으면 스크롤할수록
  // 캔버스가 쌓이기만 한다.
  it("cancels the render and drops the canvas when it scrolls out of view", () => {
    setup();
    act(() => {
      observers()[0].triggerIntersect(true);
    });
    act(() => {
      observers()[0].triggerIntersect(false);
    });
    expect(cancelCalls).toHaveBeenCalled();
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("keeps the page aspect ratio in the frame box", () => {
    setup({ width: 150 });
    const frame = document.querySelector<HTMLElement>(".pdf-thumbnail-frame");
    // 792/612 × 150 ≈ 194 — 폭과 높이를 맞바꾸면 122가 나온다.
    expect(frame?.style.width).toBe("150px");
    expect(frame?.style.height).toBe("194px");
  });

  // 자리(높이)가 렌더 도착 전에 확정돼 있지 않으면 지연 렌더가 도착할 때마다
  // 목록이 위아래로 튄다.
  it("reserves the frame box before anything is rendered", () => {
    setup();
    const frame = document.querySelector<HTMLElement>(".pdf-thumbnail-frame");
    expect(frame?.style.height).toBe("194px");
  });

  // §283 표시 폭과 래스터 폭이 갈린다 — PdfPage의 scale/renderScale과 같은
  // 계약이다. 드래그 중에는 width만 움직이고 renderWidth는 멎어 있어야 한다:
  // 렌더 effect가 `canvas.width =` 대입으로 캔버스를 **지우고** 시작하므로,
  // 라이브 폭을 그대로 쓰면 드래그하는 내내 썸네일이 비어 보인다.
  describe("§283 display width vs raster width", () => {
    it("sizes the frame from the live width", () => {
      setup({ renderWidth: 150, width: 300 });
      const frame = document.querySelector<HTMLElement>(".pdf-thumbnail-frame");
      // 792/612 × 300 ≈ 388 — 표시 크기는 즉시 커져야 한다.
      expect(frame?.style.width).toBe("300px");
      expect(frame?.style.height).toBe("388px");
    });

    it("rasters at renderWidth, not at the live width", () => {
      vi.stubGlobal("devicePixelRatio", 1);
      setup({ renderWidth: 150, width: 300 });
      act(() => {
        observers()[0].triggerIntersect(true);
      });
      const canvas = document.querySelector<HTMLCanvasElement>("canvas");
      // 라이브 폭을 따랐다면 300이다. 캔버스는 아직 옛 해상도여야 한다.
      expect(canvas?.width).toBe(150);
    });

    // ‼️ 드래그 중(width만 변함)에는 다시 그리지 않고, 놓았을 때
    // (renderWidth가 따라옴) 비로소 다시 그린다. 이 두 단정이 함께 있어야
    // "renderWidth를 받기는 하지만 deps는 여전히 width" 같은 배선을 잡는다.
    it("does not re-render while only the live width moves", () => {
      const { view, ...props } = setup({ renderWidth: 150, width: 150 });
      act(() => {
        observers()[0].triggerIntersect(true);
      });
      expect(renderCalls).toHaveBeenCalledTimes(1);

      view.rerender(<PdfThumbnail {...props} renderWidth={150} width={220} />);

      expect(renderCalls).toHaveBeenCalledTimes(1);
      expect(cancelCalls).not.toHaveBeenCalled();
    });

    it("re-renders once the raster width catches up", () => {
      const { view, ...props } = setup({ renderWidth: 150, width: 150 });
      act(() => {
        observers()[0].triggerIntersect(true);
      });
      expect(renderCalls).toHaveBeenCalledTimes(1);

      view.rerender(<PdfThumbnail {...props} renderWidth={220} width={220} />);

      expect(renderCalls).toHaveBeenCalledTimes(2);
    });
  });

  it("clamps the backing resolution at 2x on higher-density screens", () => {
    vi.stubGlobal("devicePixelRatio", 3);
    setup();
    act(() => {
      observers()[0].triggerIntersect(true);
    });
    const canvas = document.querySelector<HTMLCanvasElement>("canvas");
    // 150 CSS px × 2 = 300. dpr 3을 그대로 쓰면 450이 된다.
    expect(canvas?.width).toBe(300);
  });

  // 폭 0인 페이지(손상된 PDF)로 나누면 scale이 Infinity가 되고 viewport 크기가
  // NaN이 되어 캔버스 대입에서 던진다.
  it("does not render a page with no width", () => {
    const broken = {
      cleanup: vi.fn(() => true),
      getViewport: ({ scale }: { scale: number }) => ({
        height: 0,
        scale,
        width: 0,
      }),
      pageNumber: 1,
      render: () => {
        renderCalls();
        return { cancel: cancelCalls, promise: Promise.resolve() };
      },
    } as unknown as PDFPageProxy;
    setup({ page: broken });
    act(() => {
      observers()[0].triggerIntersect(true);
    });
    expect(renderCalls).not.toHaveBeenCalled();
  });

  it("reports the page number when clicked", async () => {
    const props = setup({ page: makePage(7) });
    await userEvent.click(screen.getByRole("button"));
    expect(props.onSelect).toHaveBeenCalledWith(7);
  });

  it("marks the current page for assistive tech", () => {
    setup({ isCurrent: true });
    expect(screen.getByRole("button")).toHaveAttribute("aria-current", "true");
  });

  it("leaves aria-current off for other pages", () => {
    setup();
    expect(screen.getByRole("button")).not.toHaveAttribute("aria-current");
  });
});

// §282.3 렌더 캐시 보관 배선. 레일이 이 누수를 **무한** 경로로 만든 장본인이다:
// 레일 본문은 독립적으로 스크롤되므로, 본문을 한 줄도 안 읽고 레일 스크롤바만
// 끝까지 끌어도 300페이지 분량의 operator list가 물린다.
describe("§282.3 PdfThumbnail render-cache retention", () => {
  /** 축출은 마이크로태스크로 미뤄진다 — 단정 전에 흘려준다. */
  async function settle(): Promise<void> {
    await new Promise<void>((resolve) => {
      queueMicrotask(resolve);
    });
  }

  it("frees the page's render cache when the thumbnail scrolls out of view", async () => {
    // 상한 0 = 놓는 즉시 축출. 상한 동작 자체는 레지스트리 테스트가 잡는다.
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
  it("cancels the in-flight render before releasing the cache", () => {
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

  // 본문 PdfPage가 그 페이지를 띄워 두고 있는데 썸네일이 스크롤로 지나갔다는
  // 이유로 비우면, 본문의 다음 줌에서 워커 왕복을 다시 한다.
  //
  // ‼️ 본문 쪽 hold를 **먼저 놓는** 것이 핵심이다 — 끝까지 쥐고 있으면 썸네일이
  // retain을 하든 말든 cleanup이 안 불려서 아무것도 고정하지 못한다(리뷰 지적).
  it("leaves the cache alone while the main view still holds the page", async () => {
    const page = makePage();
    const retention = new PdfPageRetention(0);
    const releaseMainView = retention.retain(page);
    setup({ page, retention });

    act(() => {
      observers()[0].triggerIntersect(true);
    });
    act(() => {
      observers()[0].triggerIntersect(false); // 썸네일이 스크롤로 사라졌다
    });
    await settle();

    // 본문이 아직 잡고 있다 — 썸네일이 retain하지 않았다면 여기서 이미 비워졌다.
    expect(page.cleanup).not.toHaveBeenCalled();

    releaseMainView();
    await settle();
    expect(page.cleanup).toHaveBeenCalledTimes(1);
  });
});
