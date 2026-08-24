import { describe, expect, it } from "vitest";

import { clampZoomLevel, MAX_ZOOM, MIN_ZOOM } from "../zoom";

/** use-zoom.ts의 휠 경로와 같은 산술 — 한 이벤트가 레벨에 하는 일. */
const PINCH_SENSITIVITY = 0.005;
const stepByWheel = (level: number, deltaY: number): number =>
  clampZoomLevel(level - deltaY * PINCH_SENSITIVITY);

describe("clampZoomLevel", () => {
  it("범위를 벗어난 값을 경계로 자른다", () => {
    expect(clampZoomLevel(0.1)).toBe(MIN_ZOOM);
    expect(clampZoomLevel(9)).toBe(MAX_ZOOM);
  });

  it("유한하지 않은 값은 1로 떨어뜨린다", () => {
    // NaN이 스토어에 들어가면 그 뒤 모든 배율이 NaN이 되어 화면이 사라진다.
    expect(clampZoomLevel(Number.NaN)).toBe(1);
    expect(clampZoomLevel(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampZoomLevel(Number.NEGATIVE_INFINITY)).toBe(1);
  });

  it("부동소수점 찌꺼기를 저장 가능한 정밀도로 정리한다", () => {
    // 0.1 + 0.2 = 0.30000000000000004 계열이 설정 JSON에 그대로 남지 않도록.
    expect(clampZoomLevel(1.0000000000000002)).toBe(1);
    expect(clampZoomLevel(1.23456789)).toBe(1.2346);
  });
});

describe("휠 누적 — 1% 양자화 회귀 방지", () => {
  // ‼️ 이 블록이 고정하는 버그: 예전에는 정규화가 1% 격자(`Math.round(x*100)/100`)
  // 였고, 양자화된 값이 곧 다음 이벤트의 누산기였다. 그래서 1%에 못 미치는
  // 변화량은 누적되지 못하고 매번 버려졌다.
  //
  // 단일 호출 단정으로는 이 버그를 잡을 수 없다 — 한 번 호출해서 "안 움직였다"는
  // 것은 정상적인 반올림과 구분되지 않는다. 버그의 성질은 **몇 번을 반복해도
  // 영원히 안 움직인다**는 것이므로, 반복이 단정의 일부여야 한다.

  it.each([-1, -0.5, 0.5, 1])(
    "deltaY=%s 를 반복하면 줌이 실제로 움직인다",
    (deltaY) => {
      let level = 1;
      for (let i = 0; i < 20; i++) level = stepByWheel(level, deltaY);
      expect(level).not.toBe(1);
      // 방향도 맞아야 한다: deltaY 음수 = 확대.
      expect(level > 1).toBe(deltaY < 0);
    },
  );

  it("수정 전 산술이었다면 죽었을 정확한 값들을 통과시킨다", () => {
    // 1.005 * 100 = 100.49999999999999 → 옛 반올림은 100 → 1.0 (제자리)
    expect(stepByWheel(1, -1)).toBeGreaterThan(1);
    // 0.995 * 100 = 99.5 → 옛 반올림은 half-up으로 100 → 1.0 (제자리)
    expect(stepByWheel(1, 1)).toBeLessThan(1);
  });

  it("작은 델타가 500회 누적되면 경계까지 간다", () => {
    let level = 1;
    for (let i = 0; i < 500; i++) level = stepByWheel(level, -1);
    // 옛 산술에서는 500회 뒤에도 정확히 1이었다.
    expect(level).toBe(MAX_ZOOM);
  });

  it("경계에서 더 밀어도 넘어가지 않는다", () => {
    let level = MAX_ZOOM;
    for (let i = 0; i < 10; i++) level = stepByWheel(level, -5);
    expect(level).toBe(MAX_ZOOM);

    level = MIN_ZOOM;
    for (let i = 0; i < 10; i++) level = stepByWheel(level, 5);
    expect(level).toBe(MIN_ZOOM);
  });
});
