import type { ViewportLike } from "../pdf-highlight-geom";
import type { StoredHighlight } from "../pdf-highlight-sidecar";
import type { PDFPageProxy } from "pdfjs-dist";

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PdfPage } from "../PdfPage";

// TextLayer는 실제 pdfjs 클래스를 쓰지 않는다 — 우리가 검증할 것은 "어떤
// 인자로 streamTextContent를 부르는가"와 "배율이 바뀔 때 재구축이 아니라
// update를 부르는가"다.
//
// §281.1 update의 실제 pdfjs 구현은 기존 #textDivs를 순회하며 재배치할 뿐
// 컨테이너를 비우지 않는다(legacy/build/pdf.mjs에서 확인). 여기서는 그것이
// **호출되는지**만 관찰하면 된다.
const textLayerUpdate = vi.fn();
const textLayerCtor = vi.fn();

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  TextLayer: class {
    get textContentItemsStr() {
      return [];
    }
    get textDivs() {
      return [];
    }
    constructor(...args: unknown[]) {
      textLayerCtor(...args);
    }
    cancel() {}
    render() {
      return Promise.resolve();
    }
    update(...args: unknown[]) {
      textLayerUpdate(...args);
    }
  },
  getDocument: vi.fn(),
}));

/** 항등 변환 — 좌표 계산 자체는 pdf-highlight-geom.test.ts가 왕복 항등으로
 * 고정해 뒀으니, 여기서는 아무 변환이나 일관되면 충분하다. */
function identityViewport(): ViewportLike {
  return {
    convertToPdfPoint: (x, y) => [x, y],
    convertToViewportPoint: (x, y) => [x, y],
  };
}

function makePage(streamTextContent: ReturnType<typeof vi.fn>): PDFPageProxy {
  return {
    getViewport: () => ({
      ...identityViewport(),
      height: 800,
      scale: 1,
      width: 600,
    }),
    pageNumber: 1,
    render: () => ({ cancel() {}, promise: Promise.resolve() }),
    streamTextContent,
  } as unknown as PDFPageProxy;
}

describe("§281.1 zoom must not tear down the text layer", () => {
  // ‼️ 이것은 성능 테스트가 아니라 **기능 결함**의 회귀 방지다. WKWebView 핀치의
  // 제스처 타깃은 텍스트 레이어 안의 <span>이다. 배율이 바뀔 때 레이어를
  // 재구축하면 그 span이 DOM에서 사라져 웹뷰가 제스처를 중단하고, 사용자에게는
  // "핀치가 한 스텝만 먹고 끊긴다"로 나타난다.
  //
  // 측정 (PDF 탭, 첫 핀치부터):
  //   tgt=SPAN           → gesturechange 1개 뒤 중단, gestureend 없음 (반복)
  //   tgt=pdf-text-layer → gesturechange 약 390개 + gestureend (정상)

  // ‼️ page 객체는 **한 번만** 만들어 재사용한다. 빌드 effect의 deps가
  // [visible, page]라, rerender마다 새 page를 넘기면 정당하게 재구축이 일어나
  // 이 테스트가 검증하려는 것과 무관한 이유로 실패한다. 실앱에서 page는
  // PdfPreview의 pages 배열에서 오는 안정적인 참조다.
  let streamTextContent: ReturnType<typeof vi.fn>;
  let page: ReturnType<typeof makePage>;

  function renderAtScale(scale: number) {
    const r = render(<PdfPage page={page} renderScale={scale} scale={scale} />);
    const observers = (
      globalThis as unknown as {
        MockIntersectionObserver: { instances: { triggerIntersect(): void }[] };
      }
    ).MockIntersectionObserver.instances;
    act(() => {
      observers[observers.length - 1].triggerIntersect();
    });
    return r;
  }

  beforeEach(() => {
    textLayerUpdate.mockClear();
    textLayerCtor.mockClear();
    streamTextContent = vi.fn(() => ({}));
    page = makePage(streamTextContent);
  });

  it("배율이 바뀌어도 레이어를 다시 만들지 않고 update만 부른다", () => {
    const { rerender } = renderAtScale(1);
    expect(textLayerCtor).toHaveBeenCalledTimes(1);
    expect(streamTextContent).toHaveBeenCalledTimes(1);

    for (const s of [1.2, 1.5, 1.9]) {
      rerender(<PdfPage page={page} renderScale={s} scale={s} />);
    }

    // 생성자도 텍스트 추출도 더 일어나지 않아야 한다 — 재구축이 곧 span 파괴다.
    expect(textLayerCtor).toHaveBeenCalledTimes(1);
    expect(streamTextContent).toHaveBeenCalledTimes(1);
    // 대신 배율 변경마다 재배치가 호출된다.
    expect(textLayerUpdate).toHaveBeenCalledTimes(3);
  });

  it("배율이 그대로면 update도 부르지 않는다", () => {
    const { rerender } = renderAtScale(1);
    textLayerUpdate.mockClear();

    rerender(<PdfPage page={page} renderScale={1} scale={1} />);
    expect(textLayerUpdate).not.toHaveBeenCalled();
  });
});

describe("§281.2 live zoom scales the text layer by transform, not by re-layout", () => {
  // 측정 (핀치 1.4초): gesturechange 85개에 프레임 20장 = 14.7 FPS, 최악
  // 프레임 202ms. update()는 페이지의 모든 span을 순회하며 스타일을 다시 쓴다.
  // 제스처 중에는 그것을 하지 않고 컨테이너 변환 하나로 대신한다.
  let streamTextContent: ReturnType<typeof vi.fn>;
  let page: ReturnType<typeof makePage>;

  function renderPage(scale: number, renderScale: number) {
    const r = render(
      <PdfPage page={page} renderScale={renderScale} scale={scale} />,
    );
    const observers = (
      globalThis as unknown as {
        MockIntersectionObserver: { instances: { triggerIntersect(): void }[] };
      }
    ).MockIntersectionObserver.instances;
    act(() => {
      observers[observers.length - 1].triggerIntersect();
    });
    return r;
  }

  beforeEach(() => {
    textLayerUpdate.mockClear();
    streamTextContent = vi.fn(() => ({}));
    page = makePage(streamTextContent);
  });

  it("라이브 배율만 움직이면 update를 부르지 않고 변환으로 늘린다", () => {
    const { container, rerender } = renderPage(1, 1);
    textLayerUpdate.mockClear();

    // 제스처 진행 중 — scale은 움직이지만 renderScale은 아직 정착 전이다.
    rerender(<PdfPage page={page} renderScale={1} scale={1.5} />);

    expect(textLayerUpdate).not.toHaveBeenCalled();
    const layer = container.querySelector<HTMLElement>(".pdf-text-layer");
    expect(layer?.style.transform).toBe("scale(1.5)");
  });

  it("정착하면 변환을 걷어내고 그때 한 번 재배치한다", () => {
    const { container, rerender } = renderPage(1, 1);
    rerender(<PdfPage page={page} renderScale={1} scale={1.5} />);
    textLayerUpdate.mockClear();

    rerender(<PdfPage page={page} renderScale={1.5} scale={1.5} />);

    expect(textLayerUpdate).toHaveBeenCalledTimes(1);
    const layer = container.querySelector<HTMLElement>(".pdf-text-layer");
    expect(layer?.style.transform).toBe("");
  });

  it("--total-scale-factor는 배치 배율(renderScale)을 따른다", () => {
    // 라이브 배율을 내리면 글자 크기만 커지고 위치는 그대로라 어긋난다 —
    // 이 변수의 유일한 소비자가 스팬의 font-size이기 때문이다(pdf.css).
    const { container, rerender } = renderPage(1, 1);
    rerender(<PdfPage page={page} renderScale={1} scale={1.5} />);

    const pageEl = container.querySelector<HTMLElement>(".pdf-page");
    expect(pageEl?.style.getPropertyValue("--total-scale-factor")).toBe("1");
  });
});

describe("PdfPage text extraction", () => {
  it("requests text with disableNormalization so find offsets align", () => {
    const streamTextContent = vi.fn(() => ({}));
    render(
      <PdfPage page={makePage(streamTextContent)} renderScale={1} scale={1} />,
    );

    // 페이지는 IntersectionObserver로 지연 마운트된다 — 교차를 수동 발화
    const observers = (
      globalThis as unknown as {
        MockIntersectionObserver: { instances: { triggerIntersect(): void }[] };
      }
    ).MockIntersectionObserver.instances;
    act(() => {
      observers[observers.length - 1].triggerIntersect();
    });

    expect(streamTextContent).toHaveBeenCalledWith({
      disableNormalization: true,
    });
  });
});

describe("§275.6 PdfPage highlight flash", () => {
  const HIGHLIGHT: StoredHighlight = {
    color: "yellow",
    id: "h1",
    kind: "text",
    page: 1,
    rects: [{ h: 1, w: 1, x: 0, y: 0 }],
  };

  function renderWithFlash(flashHighlightId: null | string) {
    const streamTextContent = vi.fn(() => ({}));
    const { container } = render(
      <PdfPage
        flashHighlightId={flashHighlightId}
        highlights={[HIGHLIGHT]}
        page={makePage(streamTextContent)}
        renderScale={1}
        scale={1}
      />,
    );
    const observers = (
      globalThis as unknown as {
        MockIntersectionObserver: { instances: { triggerIntersect(): void }[] };
      }
    ).MockIntersectionObserver.instances;
    act(() => {
      observers[observers.length - 1].triggerIntersect();
    });
    return container;
  }

  it("adds the flash class to the matching highlight", () => {
    const container = renderWithFlash("h1");
    const mark = container.querySelector(".pdf-hl-mark");
    expect(mark?.className).toContain("pdf-hl-mark-flash");
  });

  it("leaves other highlights and the no-flash case unmarked", () => {
    // §274 UX fix round 3 (defect B) — 채우기는 <svg><path>가 맡고,
    // .pdf-hl-mark는 이제 flash 링 전용이라 flash 대상이 없으면 아예 안
    // 그려진다(PdfPage.tsx).
    const container = renderWithFlash("some-other-id");
    expect(container.querySelector(".pdf-hl-mark")).toBeNull();
  });
});

describe("§274 UX fix round 3 (defect B) PdfPage highlight fill", () => {
  it("draws one <svg><path> per highlight with a non-empty d and the color class — not a <div> per rect", () => {
    const streamTextContent = vi.fn(() => ({}));
    const highlight: StoredHighlight = {
      color: "green",
      id: "h1",
      kind: "text",
      page: 1,
      // 세로로 겹치는 두 "줄" rect — 겹침 자체는 여기서 재확인하지 않는다
      // (buildHighlightPath 단위 테스트가 맡는다). 여기서는 PdfPage가 rect당
      // <div> 하나씩이 아니라 하나의 <svg><path>로 배선했는지만 본다.
      rects: [
        { h: 14, w: 200, x: 0, y: 0 },
        { h: 14, w: 200, x: 0, y: 10 },
      ],
    };
    const { container } = render(
      <PdfPage
        highlights={[highlight]}
        page={makePage(streamTextContent)}
        renderScale={1}
        scale={1}
      />,
    );
    const observers = (
      globalThis as unknown as {
        MockIntersectionObserver: { instances: { triggerIntersect(): void }[] };
      }
    ).MockIntersectionObserver.instances;
    act(() => {
      observers[observers.length - 1].triggerIntersect();
    });

    const svgs = container.querySelectorAll(".pdf-hl-svg");
    expect(svgs).toHaveLength(1);
    const path = svgs[0]?.querySelector("path.pdf-hl-path-green");
    expect(path).not.toBeNull();
    expect(path?.getAttribute("d")).not.toBe("");
    // rect당 배경 <div>는 더 이상 없다 — flash가 아닐 때 .pdf-hl-mark 자체가
    // 안 그려진다(위 describe 블록의 두 번째 테스트와 같은 이유).
    expect(container.querySelectorAll(".pdf-hl-mark")).toHaveLength(0);
  });
});

describe("§276.3 area capture gating", () => {
  it("marks the text layer inert while area capture is active", () => {
    const streamTextContent = vi.fn(() => ({}));
    const { container } = render(
      <PdfPage
        areaCaptureActive
        page={makePage(streamTextContent)}
        renderScale={1}
        scale={1}
      />,
    );
    const observers = (
      globalThis as unknown as {
        MockIntersectionObserver: { instances: { triggerIntersect(): void }[] };
      }
    ).MockIntersectionObserver.instances;
    act(() => {
      observers[observers.length - 1].triggerIntersect();
    });

    expect(container.querySelector(".pdf-text-layer")).toHaveClass(
      "pdf-text-layer-inert",
    );
  });

  it("leaves the text layer untouched when area capture is off (or omitted)", () => {
    const streamTextContent = vi.fn(() => ({}));
    const { container } = render(
      <PdfPage page={makePage(streamTextContent)} renderScale={1} scale={1} />,
    );
    const observers = (
      globalThis as unknown as {
        MockIntersectionObserver: { instances: { triggerIntersect(): void }[] };
      }
    ).MockIntersectionObserver.instances;
    act(() => {
      observers[observers.length - 1].triggerIntersect();
    });

    expect(container.querySelector(".pdf-text-layer")).not.toHaveClass(
      "pdf-text-layer-inert",
    );
  });

  it("renders the live drag-preview rectangle when given one", () => {
    const streamTextContent = vi.fn(() => ({}));
    const { container } = render(
      <PdfPage
        dragPreview={{ height: 40, left: 5, top: 10, width: 60 }}
        page={makePage(streamTextContent)}
        renderScale={1}
        scale={1}
      />,
    );
    const observers = (
      globalThis as unknown as {
        MockIntersectionObserver: { instances: { triggerIntersect(): void }[] };
      }
    ).MockIntersectionObserver.instances;
    act(() => {
      observers[observers.length - 1].triggerIntersect();
    });

    const preview = container.querySelector(".pdf-area-drag-preview");
    expect(preview).not.toBeNull();
    expect((preview as HTMLElement).style.left).toBe("5px");
    expect((preview as HTMLElement).style.top).toBe("10px");
    expect((preview as HTMLElement).style.width).toBe("60px");
    expect((preview as HTMLElement).style.height).toBe("40px");
  });

  it("renders no preview when dragPreview is null", () => {
    const streamTextContent = vi.fn(() => ({}));
    const { container } = render(
      <PdfPage
        dragPreview={null}
        page={makePage(streamTextContent)}
        renderScale={1}
        scale={1}
      />,
    );
    const observers = (
      globalThis as unknown as {
        MockIntersectionObserver: { instances: { triggerIntersect(): void }[] };
      }
    ).MockIntersectionObserver.instances;
    act(() => {
      observers[observers.length - 1].triggerIntersect();
    });

    expect(container.querySelector(".pdf-area-drag-preview")).toBeNull();
  });
});

describe("§274 UX fix round 5 — paint order pins hit order", () => {
  // ‼️불변식: 여기서 highlights 배열 순서 그대로 DOM에 그려진다는 것을
  // 고정한다 — pdf-highlight-hittest.ts의 hitTestTopmost는 이 순서를
  // 거꾸로(마지막부터) 훑어 "화면에서 맨 위 = 배열 마지막"을 가정한다
  // (pdf-highlight-hittest.test.ts의 hitTestTopmost describe 블록 중
  // "returns the most recently created" 테스트가 그 절반). PdfPage가
  // 언젠가 정렬해서 그리도록 바뀌면 이 테스트가 먼저
  // 깨져, hitTestTopmost도 같이 고쳐야 한다는 신호를 준다.
  it("draws highlights as <svg> siblings in the same order the highlights prop gives them, so later entries paint on top", () => {
    const streamTextContent = vi.fn(() => ({}));
    const highlights: StoredHighlight[] = [
      {
        color: "yellow",
        id: "first",
        kind: "text",
        page: 1,
        rects: [{ h: 20, w: 100, x: 0, y: 0 }],
      },
      {
        color: "green",
        id: "second",
        kind: "text",
        page: 1,
        rects: [{ h: 20, w: 100, x: 0, y: 0 }],
      },
      {
        color: "blue",
        id: "third",
        kind: "text",
        page: 1,
        rects: [{ h: 20, w: 100, x: 0, y: 0 }],
      },
    ];
    const { container } = render(
      <PdfPage
        highlights={highlights}
        page={makePage(streamTextContent)}
        renderScale={1}
        scale={1}
      />,
    );
    const observers = (
      globalThis as unknown as {
        MockIntersectionObserver: { instances: { triggerIntersect(): void }[] };
      }
    ).MockIntersectionObserver.instances;
    act(() => {
      observers[observers.length - 1].triggerIntersect();
    });

    const svgs = container.querySelectorAll(".pdf-hl-svg");
    const paintedColors = Array.from(svgs).map((svg) =>
      svg.querySelector("path")?.getAttribute("class"),
    );
    expect(paintedColors).toEqual([
      "pdf-hl-path pdf-hl-path-yellow",
      "pdf-hl-path pdf-hl-path-green",
      "pdf-hl-path pdf-hl-path-blue",
    ]);
  });
});

// §276.3.2 드래그를 놓으면 dragPreview는 사라지지만, 색을 고르기 전까지는
// 무엇을 선택했는지가 계속 보여야 한다 — 그러지 않으면 "선택이 취소된 채
// 메뉴만 뜬" 것처럼 읽힌다(사용자 보고).
describe("§276.3.2 pending area draft stays visible until a colour is picked", () => {
  function renderVisible(props: Record<string, unknown>) {
    const streamTextContent = vi.fn(() => ({}));
    const r = render(
      <PdfPage
        page={makePage(streamTextContent)}
        renderScale={1}
        scale={1}
        {...props}
      />,
    );
    const observers = (
      globalThis as unknown as {
        MockIntersectionObserver: { instances: { triggerIntersect(): void }[] };
      }
    ).MockIntersectionObserver.instances;
    act(() => {
      observers[observers.length - 1].triggerIntersect();
    });
    return r;
  }

  it("draws the draft rect after the drag has ended", () => {
    const { container } = renderVisible({
      pendingAreaRects: [{ h: 20, w: 30, x: 10, y: 40 }],
    });
    expect(container.querySelectorAll(".pdf-area-drag-preview")).toHaveLength(
      1,
    );
  });

  it("draws nothing when there is no draft", () => {
    const { container } = renderVisible({ pendingAreaRects: null });
    expect(container.querySelectorAll(".pdf-area-drag-preview")).toHaveLength(
      0,
    );
  });

  // 드래그 중에는 dragPreview가 이미 같은 자리를 그린다 — 둘 다 그리면 점선이
  // 겹쳐 두 겹으로 보인다.
  it("does not double-draw while a drag is still in progress", () => {
    const { container } = renderVisible({
      dragPreview: { height: 20, left: 10, top: 40, width: 30 },
      pendingAreaRects: [{ h: 20, w: 30, x: 10, y: 40 }],
    });
    expect(container.querySelectorAll(".pdf-area-drag-preview")).toHaveLength(
      1,
    );
  });
});
