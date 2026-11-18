import { describe, expect, it, vi } from "vitest";

import {
  anchoredScrollDelta,
  clampViewerScale,
  fitWithin,
  nextViewerZoomStop,
  pushZoomOwner,
  topZoomOwner,
  viewerWheelFactor,
} from "../viewer-zoom";

function owner() {
  return { getScale: () => 1, setScale: vi.fn() };
}

describe("nextViewerZoomStop", () => {
  it.each([
    [1, 1, 1.25],
    [1, -1, 0.9],
    [1.1, 1, 1.25],
    [1.1, -1, 1],
    [8, 1, 8],
    [0.5, -1, 0.5],
    [1.25 + 1e-9, 1, 1.5],
    [0.3, 1, 0.5],
  ])("from %f dir %i → %f", (s, d, want) => {
    expect(nextViewerZoomStop(s, d as -1 | 1)).toBe(want);
  });
});

it("clampViewerScale", () => {
  expect(clampViewerScale(0.1)).toBe(0.5);
  expect(clampViewerScale(20)).toBe(8);
  expect(clampViewerScale(Number.NaN)).toBe(1);
  expect(clampViewerScale(Infinity)).toBe(1);
});

it("viewerWheelFactor is symmetric and neutral at 0", () => {
  expect(viewerWheelFactor(0)).toBe(1);
  expect(viewerWheelFactor(-100)).toBeCloseTo(Math.exp(0.5), 10);
  expect(viewerWheelFactor(40) * viewerWheelFactor(-40)).toBeCloseTo(1, 10);
  expect(viewerWheelFactor(Number.NaN)).toBe(1);
});

it("anchoredScrollDelta keeps the point under the anchor", () => {
  const before = { height: 100, left: 0, top: 0, width: 100 };
  const after = { height: 200, left: 0, top: 0, width: 200 };
  expect(
    anchoredScrollDelta(before, after, { clientX: 50, clientY: 50 }),
  ).toEqual({ dx: 50, dy: 50 });
  expect(
    anchoredScrollDelta(before, after, { clientX: 0, clientY: 0 }),
  ).toEqual({ dx: 0, dy: 0 });
  // 내용 밖의 기준점은 가장자리로 자른다
  expect(
    anchoredScrollDelta(before, after, { clientX: -10, clientY: 50 }),
  ).toEqual({ dx: 10, dy: 50 });
});

it("fitWithin contains the aspect inside the box", () => {
  expect(fitWithin({ height: 736, width: 1336 }, 1)).toEqual({
    height: 736,
    width: 736,
  });
  expect(fitWithin({ height: 400, width: 300 }, null)).toEqual({
    height: 400,
    width: 300,
  });
});

describe("owner stack", () => {
  it("top is the last pushed; popping a lower one keeps the top; pop is idempotent", () => {
    const a = owner();
    const b = owner();
    const popA = pushZoomOwner(a);
    const popB = pushZoomOwner(b);
    expect(topZoomOwner()).toBe(b);
    popA();
    expect(topZoomOwner()).toBe(b);
    popA();
    popB();
    expect(topZoomOwner()).toBeNull();
  });

  it("the same object pushed twice: a stale release removes only its own entry", () => {
    const a = owner();
    const popFirst = pushZoomOwner(a);
    const popSecond = pushZoomOwner(a);
    // Searching by the object would find the newer entry here and leave the stack empty after
    // the second call.
    popFirst();
    popFirst();
    expect(topZoomOwner()).toBe(a);
    popSecond();
    expect(topZoomOwner()).toBeNull();
  });
});
