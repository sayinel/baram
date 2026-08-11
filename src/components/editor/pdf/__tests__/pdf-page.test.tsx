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

function makePage(streamTextContent: ReturnType<typeof vi.fn>): PDFPageProxy {
  return {
    getViewport: () => ({ height: 800, scale: 1, width: 600 }),
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
