// §282.3 레지스트리 수명 = 문서 수명.
//
// 이 배선이 PdfPreview 안에 인라인으로 있었다면 시험할 수 없다 — 그 컴포넌트는
// jsdom에서 마운트되지 않는다(use-pdf-page-retention.ts 맨 위 참조). 훅으로
// 떼어낸 유일한 이유가 이 파일이다.
import type { PDFDocumentProxy } from "pdfjs-dist";

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PdfPageRetention } from "../pdf-page-retention";
import { usePdfPageRetention } from "../use-pdf-page-retention";

function fakeDoc(numPages: number): PDFDocumentProxy {
  return { numPages } as unknown as PDFDocumentProxy;
}

describe("usePdfPageRetention", () => {
  it("keeps one registry for as long as the document stays the same", () => {
    const doc = fakeDoc(1);
    const { rerender, result } = renderHook(
      (props: { doc: PDFDocumentProxy }) => usePdfPageRetention(props.doc),
      { initialProps: { doc } },
    );
    const first = result.current;

    rerender({ doc });

    // 같은 문서에서 인스턴스가 바뀌면 모든 refcount가 리셋돼 본문이 붙잡고
    // 있는 페이지도 자유롭게 축출된다.
    expect(result.current).toBe(first);
  });

  it("swaps in a fresh registry when the document changes", () => {
    const { rerender, result } = renderHook(
      (props: { doc: PDFDocumentProxy }) => usePdfPageRetention(props.doc),
      { initialProps: { doc: fakeDoc(1) } },
    );
    const first = result.current;

    rerender({ doc: fakeDoc(2) });

    expect(result.current).not.toBe(first);
  });

  // 새 레지스트리로 갈아타면서 옛 것을 버리지 않으면, 그 맵이 **이미 파기된**
  // 페이지 프록시를 계속 붙들고 있는다. 파일을 갈아 끼울수록 쌓이는, 이번
  // 작업이 없애려는 것과 정확히 같은 모양의 누수다.
  it("disposes the previous registry on a document change", () => {
    const dispose = vi.spyOn(PdfPageRetention.prototype, "dispose");
    try {
      const { rerender } = renderHook(
        (props: { doc: PDFDocumentProxy }) => usePdfPageRetention(props.doc),
        { initialProps: { doc: fakeDoc(1) } },
      );
      expect(dispose).not.toHaveBeenCalled();

      rerender({ doc: fakeDoc(2) });
      expect(dispose).toHaveBeenCalledTimes(1);
    } finally {
      dispose.mockRestore();
    }
  });

  it("disposes the registry when the viewer unmounts", () => {
    const dispose = vi.spyOn(PdfPageRetention.prototype, "dispose");
    try {
      const { unmount } = renderHook(
        (props: { doc: PDFDocumentProxy }) => usePdfPageRetention(props.doc),
        { initialProps: { doc: fakeDoc(1) } },
      );
      unmount();
      expect(dispose).toHaveBeenCalledTimes(1);
    } finally {
      dispose.mockRestore();
    }
  });

  // 문서가 아직 로드되기 전(null)에도 레지스트리는 있어야 한다 — 자식들이
  // prop으로 받아 쓰므로 null이면 렌더가 던진다.
  it("provides a registry before the document has loaded", () => {
    const { result } = renderHook(
      (props: { doc: null | PDFDocumentProxy }) =>
        usePdfPageRetention(props.doc),
      { initialProps: { doc: null } },
    );
    expect(result.current).toBeInstanceOf(PdfPageRetention);
  });
});
