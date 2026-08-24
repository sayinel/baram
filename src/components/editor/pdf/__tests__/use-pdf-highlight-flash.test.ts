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
  // ‼️ §282.2 리뷰 M3. 레일의 하이라이트 목록에서 **같은 줄을 두 번** 클릭할 수
  // 있게 되면서 열린 경로다. 같은 id로 다시 들어오면 setFlashHighlightId(id)는
  // 값이 같아 React가 리렌더를 생략하고, 타이머 effect도 다시 돌지 않아 처음
  // 클릭의 1600ms 마감이 그대로 남는다 — 1.4초 뒤 다시 누르면 200ms만 반짝인다.
  // §275.6의 문서 간 점프는 매번 새로 마운트돼 이 경로에 닿지 않았다.
  it("restarts the flash when the same highlight is picked again", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() =>
        usePdfHighlightFlash({
          pagesReady: true,
          scrollToPage: vi.fn(),
          sidecar: SIDECAR,
        }),
      );

      act(() => {
        useLinkStore.getState().setPendingPdfHighlightId("h1");
      });
      expect(result.current.flashHighlightId).toBe("h1");

      // 첫 마감(1600ms) 직전에 같은 항목을 다시 고른다
      act(() => {
        vi.advanceTimersByTime(1400);
      });
      act(() => {
        useLinkStore.getState().setPendingPdfHighlightId("h1");
      });

      // 첫 클릭 기준 1800ms — 재시작이 없으면 1600ms에 이미 꺼졌다
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(result.current.flashHighlightId).toBe("h1");

      // 두 번째 클릭 기준으로 마감이 다시 흐르는지도 확인한다
      act(() => {
        vi.advanceTimersByTime(1300);
      });
      expect(result.current.flashHighlightId).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

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
