import type { ViewportLike } from "../pdf-highlight-geom";
import type { StoredHighlight } from "../pdf-highlight-sidecar";
import type { PDFPageProxy } from "pdfjs-dist";

import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PdfPage } from "../PdfPage";

// TextLayer는 실제 pdfjs 클래스를 쓰지 않는다 — 우리가 검증할 것은
// "어떤 인자로 streamTextContent를 부르는가"뿐이다.
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  TextLayer: class {
    get textContentItemsStr() {
      return [];
    }
    get textDivs() {
      return [];
    }
    cancel() {}
    render() {
      return Promise.resolve();
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

describe("PdfPage text extraction", () => {
  it("requests text with disableNormalization so find offsets align", () => {
    const streamTextContent = vi.fn(() => ({}));
    render(<PdfPage page={makePage(streamTextContent)} scale={1} />);

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
