import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useZoom } from "../../../../hooks/use-zoom";
import { useSettledScale } from "../use-settled-scale";

// §280 이 훅이 지키는 성질은 **시간에 대한 것**이므로 가짜 타이머로 관찰한다.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** §281.3 jsdom에는 GestureEvent 생성자가 없다 — 같은 모양으로 합성한다. */
function fireGesture(type: string, scale = 1): void {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "scale", { configurable: true, value: scale });
  act(() => {
    window.dispatchEvent(e);
  });
}

describe("useSettledScale", () => {
  it("첫 값은 기다리지 않는다", () => {
    // PdfPreview의 scale은 컨테이너를 재기 전까지 0이다. 여기서 지연시키면
    // 문서를 열 때마다 첫 페이지가 settleMs만큼 늦게 그려진다.
    const { rerender, result } = renderHook(
      ({ s }) => useSettledScale(s, 140),
      {
        initialProps: { s: 0 },
      },
    );
    expect(result.current).toBe(0);

    rerender({ s: 1.5 });
    // 타이머를 전혀 진행시키지 않았는데도 이미 따라와 있어야 한다.
    expect(result.current).toBe(1.5);
  });

  it("제스처가 멎기 전에는 마지막 안정값을 유지한다", () => {
    const { rerender, result } = renderHook(
      ({ s }) => useSettledScale(s, 140),
      {
        initialProps: { s: 0 },
      },
    );
    rerender({ s: 1 });
    expect(result.current).toBe(1);

    // 핀치 중 — 값이 계속 흔들린다.
    for (const s of [1.02, 1.05, 1.09, 1.14]) {
      rerender({ s });
      act(() => void vi.advanceTimersByTime(20));
      expect(result.current).toBe(1);
    }
  });

  it("멎으면 마지막 값으로 따라온다", () => {
    const { rerender, result } = renderHook(
      ({ s }) => useSettledScale(s, 140),
      {
        initialProps: { s: 0 },
      },
    );
    rerender({ s: 1 });
    rerender({ s: 1.4 });
    expect(result.current).toBe(1);

    act(() => void vi.advanceTimersByTime(140));
    expect(result.current).toBe(1.4);
  });

  it("멎기 전의 중간값들은 건너뛴다 — 래스터는 한 번만", () => {
    // 이 훅의 존재 이유가 이 성질이다: 중간 배율마다 다시 래스터하지 않는다.
    const seen: number[] = [];
    const { rerender } = renderHook(
      ({ s }) => {
        seen.push(useSettledScale(s, 140));
        return null;
      },
      { initialProps: { s: 0 } },
    );
    rerender({ s: 1 });
    for (const s of [1.1, 1.2, 1.3, 1.4, 1.5]) {
      rerender({ s });
      act(() => void vi.advanceTimersByTime(10));
    }
    act(() => void vi.advanceTimersByTime(140));

    const distinct = [...new Set(seen)];
    // 0(초기) → 1(첫 값, 즉시) → 1.5(정착). 중간 배율은 하나도 나오지 않는다.
    expect(distinct).toEqual([0, 1, 1.5]);
  });
});

describe("§281.3 핀치가 진행 중이면 정착하지 않는다", () => {
  // 측정 (핀치·해제 3~4회, 4.7초):
  //   제스처 중 : 프레임 32,  최악 116ms
  //   제스처 밖 : 프레임 194, 최악 157ms
  //
  // 정착은 "마지막 변화로부터 140ms"에 걸리는데, 핀치 도중 손이 잠깐 멎기만
  // 해도 조건이 성립해 재래스터가 한 프레임에 몰렸다. 아직 배율을 정하는
  // 중이므로 그 작업은 어차피 버려진다.

  function mount() {
    // useZoom이 gesture 핸들러를 window에 등록해야 상태가 움직인다.
    renderHook(() => useZoom(null));
    return renderHook(({ s }) => useSettledScale(s, 140), {
      initialProps: { s: 0 },
    });
  }

  it("제스처 중에는 정지 시간이 지나도 정착하지 않는다", () => {
    const { rerender, result } = mount();
    rerender({ s: 1 });
    expect(result.current).toBe(1);

    fireGesture("gesturestart");
    rerender({ s: 1.6 });

    // 손이 멎어 정지 시간을 훌쩍 넘겨도 — 아직 핀치 중이다.
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current).toBe(1);
  });

  it("제스처가 끝나면 그때 정착한다", () => {
    const { rerender, result } = mount();
    rerender({ s: 1 });
    fireGesture("gesturestart");
    rerender({ s: 1.6 });
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current).toBe(1);

    fireGesture("gestureend");
    act(() => void vi.advanceTimersByTime(140));
    expect(result.current).toBe(1.6);
  });
});
