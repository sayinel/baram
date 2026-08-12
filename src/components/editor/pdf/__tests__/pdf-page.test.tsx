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
    const container = renderWithFlash("some-other-id");
    const mark = container.querySelector(".pdf-hl-mark");
    expect(mark?.className).not.toContain("pdf-hl-mark-flash");
  });
});
