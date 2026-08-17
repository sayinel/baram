// §283 레일 폭 조절 — 드래그 중 라이브 값과 캔버스용 값이 **갈라진다**는 것이
// 이 훅의 전부다. 그 분리가 없으면 드래그하는 내내 썸네일이 비어 보인다
// (use-pdf-rail-resize.ts 헤더 참조).
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "../../../../stores/settings/store";
import {
  PDF_RAIL_DEFAULT_WIDTH_PX,
  PDF_RAIL_MAX_WIDTH_PX,
  PDF_RAIL_MIN_WIDTH_PX,
} from "../pdf-side-panel-utils";
import { usePdfRailResize } from "../use-pdf-rail-resize";

/**
 * React가 핸들에 붙인 onPointerDown을 부르는 대신, 훅이 하는 일을 그대로
 * 재현할 수 있도록 진짜 엘리먼트를 준다. setPointerCapture 계열은 jsdom에
 * 없으므로 여기서 채운다 — 없으면 드래그 시작이 곧바로 던진다.
 */
function makeHandle(): HTMLElement {
  const el = document.createElement("div");
  const captured = new Set<number>();
  Object.assign(el, {
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: (id: number) => captured.delete(id),
    setPointerCapture: (id: number) => captured.add(id),
  });
  document.body.appendChild(el);
  return el;
}

/** 포인터 이벤트를 실제로 흉내 낸다 — jsdom에는 PointerEvent가 없다. */
function pointerEvent(type: string, clientX: number): Event {
  const e = new Event(type, { bubbles: true });
  Object.assign(e, { clientX, pointerId: 1 });
  return e;
}

function startDrag(
  result: { current: ReturnType<typeof usePdfRailResize> },
  handle: HTMLElement,
  clientX: number,
) {
  act(() => {
    result.current.onResizeStart({
      button: 0,
      clientX,
      currentTarget: handle,
      pointerId: 1,
      preventDefault: vi.fn(),
    } as unknown as React.PointerEvent<HTMLElement>);
  });
}

beforeEach(() => {
  document.body.replaceChildren();
  useSettingsStore.setState({ pdfRailWidth: PDF_RAIL_DEFAULT_WIDTH_PX });
});

describe("usePdfRailResize", () => {
  it("starts at the stored width, with both values agreeing", () => {
    const { result } = renderHook(() => usePdfRailResize());

    expect(result.current.width).toBe(PDF_RAIL_DEFAULT_WIDTH_PX);
    expect(result.current.rasterWidth).toBe(PDF_RAIL_DEFAULT_WIDTH_PX);
    expect(result.current.isResizing).toBe(false);
  });

  // ‼️ 이것이 이 훅이 존재하는 이유다.
  it("moves the live width during a drag but leaves the raster width alone", () => {
    const { result } = renderHook(() => usePdfRailResize());
    const handle = makeHandle();
    startDrag(result, handle, 500);

    act(() => {
      handle.dispatchEvent(pointerEvent("pointermove", 560));
    });

    expect(result.current.width).toBe(PDF_RAIL_DEFAULT_WIDTH_PX + 60);
    expect(result.current.rasterWidth).toBe(PDF_RAIL_DEFAULT_WIDTH_PX);
    expect(result.current.isResizing).toBe(true);
  });

  it("brings the raster width up to the live width when the drag is released", () => {
    const { result } = renderHook(() => usePdfRailResize());
    const handle = makeHandle();
    startDrag(result, handle, 500);

    act(() => {
      handle.dispatchEvent(pointerEvent("pointermove", 560));
      handle.dispatchEvent(pointerEvent("pointerup", 560));
    });

    expect(result.current.width).toBe(PDF_RAIL_DEFAULT_WIDTH_PX + 60);
    expect(result.current.rasterWidth).toBe(PDF_RAIL_DEFAULT_WIDTH_PX + 60);
    expect(result.current.isResizing).toBe(false);
  });

  it("persists the released width to settings", () => {
    const { result } = renderHook(() => usePdfRailResize());
    const handle = makeHandle();
    startDrag(result, handle, 500);

    act(() => {
      handle.dispatchEvent(pointerEvent("pointermove", 460));
      handle.dispatchEvent(pointerEvent("pointerup", 460));
    });

    expect(useSettingsStore.getState().pdfRailWidth).toBe(
      PDF_RAIL_DEFAULT_WIDTH_PX - 40,
    );
  });

  // 드래그 중에는 설정에 쓰지 않는다 — persist가 디스크를 타므로 매 프레임
  // 쓰면 마우스를 한 번 끄는 동안 수백 번 저장한다.
  it("does not write to settings until the drag ends", () => {
    const { result } = renderHook(() => usePdfRailResize());
    const handle = makeHandle();
    startDrag(result, handle, 500);

    act(() => {
      handle.dispatchEvent(pointerEvent("pointermove", 560));
      handle.dispatchEvent(pointerEvent("pointermove", 580));
    });

    expect(useSettingsStore.getState().pdfRailWidth).toBe(
      PDF_RAIL_DEFAULT_WIDTH_PX,
    );
  });

  it.each([
    ["past the maximum", 9000, PDF_RAIL_MAX_WIDTH_PX],
    ["past the minimum", -9000, PDF_RAIL_MIN_WIDTH_PX],
  ])("clamps a drag %s", (_label, delta, expected) => {
    const { result } = renderHook(() => usePdfRailResize());
    const handle = makeHandle();
    startDrag(result, handle, 500);

    act(() => {
      handle.dispatchEvent(pointerEvent("pointermove", 500 + delta));
    });

    expect(result.current.width).toBe(expected);
  });

  // pointercancel은 OS가 제스처를 가로챘을 때 온다(예: 3-finger swipe).
  // 그때 드래그 상태가 남으면 레일이 영원히 "조절 중"으로 굳는다.
  it("ends the drag on pointercancel", () => {
    const { result } = renderHook(() => usePdfRailResize());
    const handle = makeHandle();
    startDrag(result, handle, 500);

    act(() => {
      handle.dispatchEvent(pointerEvent("pointermove", 560));
      handle.dispatchEvent(pointerEvent("pointercancel", 560));
    });

    expect(result.current.isResizing).toBe(false);
  });

  // 주 버튼이 아니면 시작하지 않는다 — 오른쪽 클릭 드래그가 컨텍스트 메뉴와
  // 겹친다.
  it("ignores a non-primary button", () => {
    const { result } = renderHook(() => usePdfRailResize());
    const handle = makeHandle();

    act(() => {
      result.current.onResizeStart({
        button: 2,
        clientX: 500,
        currentTarget: handle,
        pointerId: 1,
        preventDefault: vi.fn(),
      } as unknown as React.PointerEvent<HTMLElement>);
    });

    expect(result.current.isResizing).toBe(false);
  });

  describe("keyboard", () => {
    function press(
      result: { current: ReturnType<typeof usePdfRailResize> },
      key: string,
      shiftKey = false,
    ) {
      const preventDefault = vi.fn();
      act(() => {
        result.current.onResizeKeyDown({
          key,
          preventDefault,
          shiftKey,
        } as unknown as React.KeyboardEvent<HTMLElement>);
      });
      return preventDefault;
    }

    it.each([
      ["ArrowRight", false, PDF_RAIL_DEFAULT_WIDTH_PX + 8],
      ["ArrowLeft", false, PDF_RAIL_DEFAULT_WIDTH_PX - 8],
      ["ArrowRight", true, PDF_RAIL_DEFAULT_WIDTH_PX + 40],
      ["Home", false, PDF_RAIL_MIN_WIDTH_PX],
      ["End", false, PDF_RAIL_MAX_WIDTH_PX],
    ])("%s (shift: %s) resizes to %i", (key, shift, expected) => {
      const { result } = renderHook(() => usePdfRailResize());

      press(result, key as string, shift as boolean);

      expect(result.current.width).toBe(expected);
    });

    // ‼️ 방향키를 그냥 두면 레일 본문이 함께 스크롤된다(§282.4의 같은 이유).
    it("consumes the arrow keys so the rail does not scroll under the handle", () => {
      const { result } = renderHook(() => usePdfRailResize());

      expect(press(result, "ArrowRight")).toHaveBeenCalled();
    });

    it("leaves other keys to the rest of the app", () => {
      const { result } = renderHook(() => usePdfRailResize());

      expect(press(result, "a")).not.toHaveBeenCalled();
      expect(result.current.width).toBe(PDF_RAIL_DEFAULT_WIDTH_PX);
    });

    // 키보드에는 "놓는 순간"이 없으므로 즉시 커밋한다 — 그래야 래스터도
    // 따라온다. 한 번의 변화량이 8px이라 재렌더 비용이 문제되지 않는다.
    it("commits immediately, so the raster follows", () => {
      const { result } = renderHook(() => usePdfRailResize());

      press(result, "ArrowRight");

      expect(result.current.rasterWidth).toBe(PDF_RAIL_DEFAULT_WIDTH_PX + 8);
      expect(useSettingsStore.getState().pdfRailWidth).toBe(
        PDF_RAIL_DEFAULT_WIDTH_PX + 8,
      );
    });
  });
});
