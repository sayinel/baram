// §282.1 썸네일 — 지연 렌더와 종횡비.
import type { PDFPageProxy } from "pdfjs-dist";

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    tabIndex: 0,
    width: 150,
    ...overrides,
  };
  render(<PdfThumbnail {...props} />);
  return props;
}

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
