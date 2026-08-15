import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSettledScale } from "../use-settled-scale";

// §280 이 훅이 지키는 성질은 **시간에 대한 것**이므로 가짜 타이머로 관찰한다.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

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
