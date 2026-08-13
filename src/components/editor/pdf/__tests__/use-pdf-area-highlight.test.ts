// §276.3 usePdfAreaHighlight — mode/alt gating, drag lifecycle, cancel paths.
import type { ViewportLike } from "../pdf-highlight-geom";

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePdfAreaHighlight } from "../use-pdf-area-highlight";

function fireKeyDown(key: string) {
  document.dispatchEvent(new KeyboardEvent("keydown", { key }));
}

function fireKeyUp(key: string) {
  document.dispatchEvent(new KeyboardEvent("keyup", { key }));
}

function fireMouseMove(x: number, y: number) {
  document.dispatchEvent(
    new MouseEvent("mousemove", { clientX: x, clientY: y }),
  );
}

function fireMouseUp(x: number, y: number) {
  document.dispatchEvent(new MouseEvent("mouseup", { clientX: x, clientY: y }));
}

function identityViewport(): ViewportLike {
  return {
    convertToPdfPoint: (x, y) => [x, y],
    convertToViewportPoint: (x, y) => [x, y],
  };
}

describe("usePdfAreaHighlight", () => {
  const onAreaHighlightDrawn = vi.fn();

  beforeEach(() => {
    onAreaHighlightDrawn.mockClear();
  });

  afterEach(() => {
    // Alt가 눌린 채로 남는 테스트가 다음 테스트를 오염시키지 않게.
    fireKeyUp("Alt");
  });

  it("toggleAreaMode flips areaMode and areaCaptureActive", () => {
    const { result } = renderHook(() =>
      usePdfAreaHighlight({ onAreaHighlightDrawn }),
    );
    expect(result.current.areaMode).toBe(false);
    expect(result.current.areaCaptureActive).toBe(false);

    act(() => result.current.toggleAreaMode());
    expect(result.current.areaMode).toBe(true);
    expect(result.current.areaCaptureActive).toBe(true);

    act(() => result.current.toggleAreaMode());
    expect(result.current.areaMode).toBe(false);
    expect(result.current.areaCaptureActive).toBe(false);
  });

  it("holding Alt activates capture without flipping the toggle's own state", () => {
    const { result } = renderHook(() =>
      usePdfAreaHighlight({ onAreaHighlightDrawn }),
    );

    act(() => fireKeyDown("Alt"));
    expect(result.current.areaCaptureActive).toBe(true);
    // aria-pressed는 이 값만 반영해야 한다 — Alt를 누르고 있다고 토글
    // 버튼이 눌린 것처럼 보이면 안 된다(브리프의 명시적 요구).
    expect(result.current.areaMode).toBe(false);

    act(() => fireKeyUp("Alt"));
    expect(result.current.areaCaptureActive).toBe(false);
  });

  it("window blur clears a stuck Alt hold", () => {
    const { result } = renderHook(() =>
      usePdfAreaHighlight({ onAreaHighlightDrawn }),
    );
    act(() => fireKeyDown("Alt"));
    expect(result.current.areaCaptureActive).toBe(true);

    act(() => window.dispatchEvent(new Event("blur")));
    expect(result.current.areaCaptureActive).toBe(false);
  });

  it("a meaningful drag calls onAreaHighlightDrawn with the converted rect", () => {
    const { result } = renderHook(() =>
      usePdfAreaHighlight({ onAreaHighlightDrawn }),
    );

    act(() => {
      result.current.onPageMouseDown(
        3,
        identityViewport(),
        { left: 10, top: 20 },
        30,
        40,
      );
    });
    act(() => fireMouseMove(130, 140));
    act(() => fireMouseUp(130, 140));

    expect(onAreaHighlightDrawn).toHaveBeenCalledTimes(1);
    const payload = onAreaHighlightDrawn.mock.calls[0][0];
    expect(payload.pageNumber).toBe(3);
    // identity viewport, pageOrigin (10,20) 뺀 값 — (30,40)-(130,140) drag
    expect(payload.rects).toEqual([{ h: 100, w: 100, x: 20, y: 20 }]);
    expect(payload.text).toBe("Area highlight (page 3)");
  });

  it("clears the live preview after the drag completes", () => {
    const { result } = renderHook(() =>
      usePdfAreaHighlight({ onAreaHighlightDrawn }),
    );
    act(() => {
      result.current.onPageMouseDown(
        1,
        identityViewport(),
        { left: 0, top: 0 },
        0,
        0,
      );
    });
    act(() => fireMouseMove(50, 50));
    expect(result.current.dragPreview).toEqual({
      pageNumber: 1,
      rect: { height: 50, left: 0, top: 0, width: 50 },
    });

    act(() => fireMouseUp(50, 50));
    expect(result.current.dragPreview).toBeNull();
  });

  it("a click with no real movement creates nothing", () => {
    const { result } = renderHook(() =>
      usePdfAreaHighlight({ onAreaHighlightDrawn }),
    );
    act(() => {
      result.current.onPageMouseDown(
        1,
        identityViewport(),
        { left: 0, top: 0 },
        50,
        50,
      );
    });
    act(() => fireMouseUp(51, 51)); // 1px 미만 — MIN_DRAG_SIZE_PX 미만

    expect(onAreaHighlightDrawn).not.toHaveBeenCalled();
    expect(result.current.dragPreview).toBeNull();
  });

  it("Escape mid-drag cancels cleanly — a later mouseup does nothing (listeners were removed)", () => {
    const { result } = renderHook(() =>
      usePdfAreaHighlight({ onAreaHighlightDrawn }),
    );
    act(() => {
      result.current.onPageMouseDown(
        1,
        identityViewport(),
        { left: 0, top: 0 },
        0,
        0,
      );
    });
    act(() => fireMouseMove(200, 200));
    expect(result.current.dragPreview).not.toBeNull();

    act(() => fireKeyDown("Escape"));
    expect(result.current.dragPreview).toBeNull();

    // 취소는 리스너 자체를 뗀다 — 그 뒤의 mouseup은 아무 효과가 없어야 한다.
    act(() => fireMouseUp(200, 200));
    expect(onAreaHighlightDrawn).not.toHaveBeenCalled();
  });

  it("toggling the mode off mid-drag cancels without creating anything", () => {
    const { result } = renderHook(() =>
      usePdfAreaHighlight({ onAreaHighlightDrawn }),
    );
    act(() => result.current.toggleAreaMode()); // mode ON
    act(() => {
      result.current.onPageMouseDown(
        1,
        identityViewport(),
        { left: 0, top: 0 },
        0,
        0,
      );
    });
    act(() => fireMouseMove(200, 200));

    act(() => result.current.toggleAreaMode()); // mode OFF mid-drag
    expect(result.current.dragPreview).toBeNull();

    act(() => fireMouseUp(200, 200));
    expect(onAreaHighlightDrawn).not.toHaveBeenCalled();
  });

  it("releasing Alt mid-drag cancels the same way toggling off does", () => {
    const { result } = renderHook(() =>
      usePdfAreaHighlight({ onAreaHighlightDrawn }),
    );
    act(() => fireKeyDown("Alt"));
    act(() => {
      result.current.onPageMouseDown(
        1,
        identityViewport(),
        { left: 0, top: 0 },
        0,
        0,
      );
    });
    act(() => fireMouseMove(200, 200));

    act(() => fireKeyUp("Alt"));
    expect(result.current.dragPreview).toBeNull();

    act(() => fireMouseUp(200, 200));
    expect(onAreaHighlightDrawn).not.toHaveBeenCalled();
  });

  it("Alt+drag and the toggle reach the identical code path", () => {
    // 인스턴스 A — 토글로 진입.
    const drawnA = vi.fn();
    const a = renderHook(() =>
      usePdfAreaHighlight({ onAreaHighlightDrawn: drawnA }),
    );
    act(() => a.result.current.toggleAreaMode());
    act(() => {
      a.result.current.onPageMouseDown(
        2,
        identityViewport(),
        { left: 5, top: 5 },
        10,
        10,
      );
    });
    act(() => fireMouseMove(60, 60));
    act(() => fireMouseUp(60, 60));
    a.unmount();

    // Alt 해제 후 인스턴스 A가 남긴 리스너가 인스턴스 B에 영향 없게 확인하는
    // 대신, 인스턴스 A를 완전히 unmount하고 B를 새로 만든다.
    const drawnB = vi.fn();
    const b = renderHook(() =>
      usePdfAreaHighlight({ onAreaHighlightDrawn: drawnB }),
    );
    act(() => fireKeyDown("Alt"));
    act(() => {
      b.result.current.onPageMouseDown(
        2,
        identityViewport(),
        { left: 5, top: 5 },
        10,
        10,
      );
    });
    act(() => fireMouseMove(60, 60));
    act(() => fireMouseUp(60, 60));
    act(() => fireKeyUp("Alt"));

    expect(drawnA).toHaveBeenCalledTimes(1);
    expect(drawnB).toHaveBeenCalledTimes(1);
    expect(drawnA.mock.calls[0][0]).toEqual(drawnB.mock.calls[0][0]);
  });
});
