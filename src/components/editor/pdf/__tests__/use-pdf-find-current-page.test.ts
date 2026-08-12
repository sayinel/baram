// §276 Task 12 correction 1 — currentPage must be REACTIVE: it should update
// as the user scrolls, not just be computable on demand via getCurrentPage().
// Stubs getBoundingClientRect per element (jsdom returns a zero rect for
// everything otherwise — the well-known layout-untestable gotcha documented
// on PdfPreview.tsx's resolvePageBoxEl) so the "topmost visible page"
// algorithm has something real to compare against.
//
// doc is intentionally null: the reactive-currentPage effect depends only on
// getScrollElement + pages, not on the PDFFindController lifecycle, so this
// stays clear of that entirely (no pdfjs module mocking needed).
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { usePdfFind } from "../use-pdf-find";

function elAt(top: number): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => ({ top }) as DOMRect;
  return el;
}

function fakePage(pageNumber: number): PDFPageProxy {
  return { pageNumber } as unknown as PDFPageProxy;
}

describe("usePdfFind — reactive currentPage", () => {
  it("starts at page 1 before any page element is registered", () => {
    const scrollEl = document.createElement("div");
    scrollEl.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;

    const { result } = renderHook(() =>
      usePdfFind({
        doc: null,
        getScrollElement: () => scrollEl,
        isOpen: false,
        pages: [],
      }),
    );

    expect(result.current.currentPage).toBe(1);
  });

  it("updates on scroll to the topmost page whose top is at or above the container's top", async () => {
    const scrollEl = document.createElement("div");
    scrollEl.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    const doc = null as unknown as PDFDocumentProxy;
    const pages = [fakePage(1), fakePage(2), fakePage(3)];

    const { result } = renderHook(() =>
      usePdfFind({
        doc,
        getScrollElement: () => scrollEl,
        isOpen: false,
        pages,
      }),
    );

    act(() => {
      result.current.registerPageEl(1, elAt(-100));
      result.current.registerPageEl(2, elAt(-10));
      result.current.registerPageEl(3, elAt(50));
    });

    // getCurrentPage() itself is already correct the instant elements are
    // registered — this asserts the REACTIVE mirror, which only updates on
    // a scroll event (this is exactly what correction 1 required: without
    // it, this call would still read the stale default from mount).
    act(() => scrollEl.dispatchEvent(new Event("scroll")));

    await waitFor(() => expect(result.current.currentPage).toBe(2));
  });

  it("re-samples immediately when pages change, without waiting for a scroll (file switch without scrolling)", async () => {
    const scrollEl = document.createElement("div");
    scrollEl.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    // Stable across rerenders, matching production (PdfPreview.tsx passes a
    // useCallback). A fresh arrow per render was the bug the review caught:
    // getCurrentPage's own identity depends on getScrollElement, so an
    // unstable one re-arms the effect on EVERY render regardless of whether
    // `pages` actually changed — which is exactly why the original version
    // of this test kept passing after `pages` was deliberately dropped from
    // the effect's deps (use-pdf-find.ts) in a reproduction of the bug.
    const getScrollElement = () => scrollEl;

    const { rerender, result } = renderHook(
      (props: { pages: PDFPageProxy[] }) =>
        usePdfFind({
          doc: null,
          getScrollElement,
          isOpen: false,
          pages: props.pages,
        }),
      { initialProps: { pages: [fakePage(1)] } },
    );
    // No scroll event anywhere in this test — page 1 registers via a ref
    // mutation only (registerPageEl doesn't itself trigger a re-render), so
    // currentPage cannot move off its mount-time default of 1 through any
    // path OTHER than the pages-change re-sample this test exists to prove.
    // (An earlier version of this test dispatched a "scroll" event and
    // awaited currentPage===1 here — vacuous, since 1 is already the initial
    // value: that wait resolved instantly and left the scroll's rAF
    // pending, which was what actually produced "5" later, not the `pages`
    // dependency under test.)
    act(() => result.current.registerPageEl(1, elAt(0)));

    // Switching PDFs clears the old page's registration (PdfPreview's ref
    // callback fires with null on unmount) before the new one's pages mount.
    act(() => result.current.registerPageEl(1, null));
    act(() => {
      result.current.registerPageEl(5, elAt(-5));
    });
    rerender({ pages: [fakePage(5)] });

    await waitFor(() => expect(result.current.currentPage).toBe(5));
  });
});
