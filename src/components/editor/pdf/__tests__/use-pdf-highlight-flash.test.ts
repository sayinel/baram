import type { Sidecar } from "../pdf-highlight-sidecar";

// §275.6 usePdfHighlightFlash — consumes the pending highlight id set by
// use-navigation.ts and scrolls/flashes once this PDF's own sidecar + pages
// are ready.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLinkStore } from "../../../../stores/editor/link";
import { usePdfHighlightFlash } from "../use-pdf-highlight-flash";

const SIDECAR: Sidecar = {
  companion: "highlights/papers/attention.md",
  highlights: [
    {
      color: "yellow",
      id: "h1",
      kind: "text",
      page: 3,
      rects: [{ h: 1, w: 1, x: 0, y: 0 }],
    },
  ],
  pdf: "papers/attention.pdf",
  version: 1,
};

beforeEach(() => {
  useLinkStore.setState({ pendingPdfHighlightId: null });
});

describe("usePdfHighlightFlash", () => {
  it("does nothing while there is no pending highlight", () => {
    const scrollToPage = vi.fn();
    const { result } = renderHook(() =>
      usePdfHighlightFlash({
        pagesReady: true,
        scrollToPage,
        sidecar: SIDECAR,
      }),
    );

    expect(scrollToPage).not.toHaveBeenCalled();
    expect(result.current.flashHighlightId).toBeNull();
  });

  it("scrolls to the highlight's page and flashes it once pages are ready and the sidecar has it", () => {
    const scrollToPage = vi.fn();
    act(() => useLinkStore.getState().setPendingPdfHighlightId("h1"));

    const { result } = renderHook(() =>
      usePdfHighlightFlash({
        pagesReady: true,
        scrollToPage,
        sidecar: SIDECAR,
      }),
    );

    expect(scrollToPage).toHaveBeenCalledWith(3);
    expect(result.current.flashHighlightId).toBe("h1");
    // Consumed — a later, unrelated sidecar reload must not replay this jump.
    expect(useLinkStore.getState().pendingPdfHighlightId).toBeNull();
  });

  it("waits for pages to be ready before scrolling", () => {
    const scrollToPage = vi.fn();
    act(() => useLinkStore.getState().setPendingPdfHighlightId("h1"));

    const { rerender } = renderHook(
      (props: { pagesReady: boolean }) =>
        usePdfHighlightFlash({
          pagesReady: props.pagesReady,
          scrollToPage,
          sidecar: SIDECAR,
        }),
      { initialProps: { pagesReady: false } },
    );
    expect(scrollToPage).not.toHaveBeenCalled();
    expect(useLinkStore.getState().pendingPdfHighlightId).toBe("h1");

    rerender({ pagesReady: true });
    expect(scrollToPage).toHaveBeenCalledWith(3);
  });

  it("consumes the pending id without scrolling when the highlight is gone (deleted between nav-time check and now)", () => {
    const scrollToPage = vi.fn();
    act(() => useLinkStore.getState().setPendingPdfHighlightId("deleted-id"));

    renderHook(() =>
      usePdfHighlightFlash({
        pagesReady: true,
        scrollToPage,
        sidecar: SIDECAR,
      }),
    );

    expect(scrollToPage).not.toHaveBeenCalled();
    expect(useLinkStore.getState().pendingPdfHighlightId).toBeNull();
  });

  it("clears the flash after the animation window", () => {
    vi.useFakeTimers();
    try {
      const scrollToPage = vi.fn();
      act(() => useLinkStore.getState().setPendingPdfHighlightId("h1"));

      const { result } = renderHook(() =>
        usePdfHighlightFlash({
          pagesReady: true,
          scrollToPage,
          sidecar: SIDECAR,
        }),
      );
      expect(result.current.flashHighlightId).toBe("h1");

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(result.current.flashHighlightId).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
