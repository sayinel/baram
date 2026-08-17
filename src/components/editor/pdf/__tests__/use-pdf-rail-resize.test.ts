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
} from "../../../../utils/pdf-rail-width";
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

  // ‼️ persist의 기본 merge는 저장값을 **setter를 통하지 않고** 얕게 밀어
  // 넣는다. 그래서 setPdfRailWidth의 clamp를 우회한 값이 스토어에 들어올 수
  // 있다 — 손상된 설정 파일, 또는 다음 릴리스에서 범위를 좁혔을 때의 옛 값.
  // 여기서 자르지 않으면 railContentWidth를 거치는 소비자(썸네일·크롭)와
  // 그렇지 않은 소비자(CSS 변수·fit-width)가 서로 다른 폭을 본다.
  //
  // setState로 직접 넣는 것이 바로 그 경로의 재현이다 — setter를 부르면
  // 이미 잘려서 들어가므로 아무것도 고정하지 못한다.
  it.each([
    ["above the maximum", 5000, PDF_RAIL_MAX_WIDTH_PX],
    ["below the minimum", 20, PDF_RAIL_MIN_WIDTH_PX],
    ["not a number", Number.NaN, PDF_RAIL_DEFAULT_WIDTH_PX],
  ])("clamps a rehydrated width %s", (_label, stored, expected) => {
    useSettingsStore.setState({ pdfRailWidth: stored });

    const { result } = renderHook(() => usePdfRailResize());

    expect(result.current.width).toBe(expected);
    expect(result.current.rasterWidth).toBe(expected);
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
      handle.dispatchEvent(pointerEvent("pointermove", 540));
      handle.dispatchEvent(pointerEvent("pointerup", 540));
    });

    expect(useSettingsStore.getState().pdfRailWidth).toBe(
      PDF_RAIL_DEFAULT_WIDTH_PX + 40,
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

  // ‼️ 리뷰가 실측으로 잡았다: 두 번째 pointerdown이 공유 기준점을 덮어써서,
  // 진행 중이던 첫 드래그가 하한으로 130px 역방향 점프했다. 멀티터치 노트북이나
  // 마우스+펜에서 실제로 온다.
  it("ignores a second pointer while a drag is in flight", () => {
    const { result } = renderHook(() => usePdfRailResize());
    const handle = makeHandle();
    startDrag(result, handle, 500);
    act(() => {
      handle.dispatchEvent(pointerEvent("pointermove", 560));
    });
    expect(result.current.width).toBe(PDF_RAIL_DEFAULT_WIDTH_PX + 60);

    // 두 번째 포인터가 아주 먼 곳에서 눌린다.
    startDrag(result, handle, 900);

    // 첫 드래그가 흔들리지 않아야 한다.
    expect(result.current.width).toBe(PDF_RAIL_DEFAULT_WIDTH_PX + 60);

    act(() => {
      handle.dispatchEvent(pointerEvent("pointermove", 570));
    });
    expect(result.current.width).toBe(PDF_RAIL_DEFAULT_WIDTH_PX + 70);
  });

  // 드래그가 끝나면 다시 시작할 수 있어야 한다 — 가드가 한 번 켜지고 안 꺼지면
  // 첫 드래그 이후 레일이 영영 안 움직인다.
  it("accepts a new drag after the previous one ends", () => {
    const { result } = renderHook(() => usePdfRailResize());
    const handle = makeHandle();
    startDrag(result, handle, 500);
    act(() => {
      handle.dispatchEvent(pointerEvent("pointerup", 540));
    });

    startDrag(result, handle, 500);
    act(() => {
      handle.dispatchEvent(pointerEvent("pointermove", 520));
    });

    expect(result.current.isResizing).toBe(true);
    expect(result.current.width).toBe(PDF_RAIL_DEFAULT_WIDTH_PX + 60);
  });

  // 드래그 직후 방향키로 미세 조정하려면 손잡이가 포커스를 받아야 한다.
  // pointerdown의 preventDefault가 호환 mousedown을 막아 기본 포커스가 오지
  // 않으므로 훅이 명시적으로 준다.
  it("focuses the handle so the keyboard path continues from the drag", () => {
    const { result } = renderHook(() => usePdfRailResize());
    const handle = makeHandle();
    handle.tabIndex = 0;
    startDrag(result, handle, 500);

    expect(document.activeElement).toBe(handle);
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
