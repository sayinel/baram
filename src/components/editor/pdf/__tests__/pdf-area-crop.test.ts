import { describe, expect, it } from "vitest";

import { computeAreaCropLayout } from "../pdf-area-crop";

/** 축소가 필요 없는 기본 크기 — 개별 테스트가 필요한 필드만 덮어쓴다. */
const RECT = { height: 100, left: 50, top: 30, width: 200 };

function layout(
  overrides: Partial<{
    dpr: number;
    height: number;
    left: number;
    maxCssWidth: number;
    top: number;
    width: number;
  }> = {},
) {
  const { dpr = 1, maxCssWidth = 640, ...rect } = overrides;
  return computeAreaCropLayout({
    dpr,
    maxCssWidth,
    pageLocalAtScale1: { ...RECT, ...rect },
  });
}

describe("computeAreaCropLayout", () => {
  it("keeps the scale-1 size when the region already fits maxCssWidth", () => {
    expect(layout()).toEqual({
      canvasHeight: 100,
      canvasWidth: 200,
      cssHeight: 100,
      cssWidth: 200,
      offsetX: -50,
      offsetY: -30,
      renderScale: 1,
    });
  });

  it("never enlarges a region narrower than maxCssWidth", () => {
    // 40 CSS px wide with a 640 px budget: upscaling would only blur it.
    const result = layout({ height: 20, width: 40 });
    expect(result?.cssWidth).toBe(40);
    expect(result?.renderScale).toBe(1);
  });

  it("shrinks proportionally when the region is wider than maxCssWidth", () => {
    const result = layout({ height: 640, maxCssWidth: 640, width: 1280 });
    expect(result?.cssWidth).toBe(640);
    expect(result?.cssHeight).toBe(320); // aspect ratio preserved
    expect(result?.renderScale).toBe(0.5);
  });

  it("offsets the viewport by the NEGATED crop origin so it lands on the canvas", () => {
    // pdfjs adds offsetX/offsetY in already-scaled viewport space, so moving
    // the crop's top-left to (0,0) means -left*renderScale / -top*renderScale.
    // A positive offset would push the region further off-canvas.
    const result = layout({ dpr: 2, left: 100, top: 40 });
    expect(result?.renderScale).toBe(2);
    expect(result?.offsetX).toBe(-200);
    expect(result?.offsetY).toBe(-80);
  });

  it.each([
    ["below 1 is clamped up", 0.5, 1],
    ["1 passes through", 1, 1],
    ["2 passes through", 2, 2],
    ["above 2 is clamped down (memory ceiling)", 3, 2],
  ])("dpr %s", (_label, dpr, expected) => {
    const result = layout({ dpr });
    expect(result?.renderScale).toBe(expected);
    expect(result?.canvasWidth).toBe(200 * expected);
    // CSS size is independent of dpr — only the backing store grows.
    expect(result?.cssWidth).toBe(200);
  });

  it("falls back to dpr 1 when devicePixelRatio is not finite", () => {
    // Math.min(Math.max(NaN, 1), 2) is NaN — clamping alone does not save us,
    // so the guard has to come first or the canvas ends up NaN-sized.
    const result = layout({ dpr: NaN });
    expect(result?.renderScale).toBe(1);
    expect(result?.canvasWidth).toBe(200);
  });

  it("never returns a zero-size canvas (pdfjs throws on one)", () => {
    const result = layout({ height: 0.2, width: 0.2 });
    expect(result?.canvasWidth).toBe(1);
    expect(result?.canvasHeight).toBe(1);
  });

  // ‼️ 판별력: 이 케이스들은 `Number.isFinite` 가드를 `typeof === "number"`나
  // 크기 비교만으로 바꾸면 전부 통과해 버린다 — NaN은 어떤 비교에도 걸리지
  // 않기 때문이다. 사이드카 검증기(isPdfRect)가 바로 그 typeof 검사를 쓰고
  // 있어 NaN 좌표는 실제로 여기까지 온다.
  it.each([
    ["NaN width", { width: NaN }],
    ["NaN height", { height: NaN }],
    ["NaN left", { left: NaN }],
    ["NaN top", { top: NaN }],
    ["Infinite width", { width: Infinity }],
    ["Infinite height", { height: Infinity }],
    ["Infinite left", { left: Infinity }],
    ["zero width", { width: 0 }],
    ["zero height", { height: 0 }],
    ["negative width", { width: -10 }],
    ["negative height", { height: -10 }],
    ["zero maxCssWidth", { maxCssWidth: 0 }],
    ["NaN maxCssWidth", { maxCssWidth: NaN }],
  ])("returns null for %s", (_label, overrides) => {
    expect(layout(overrides)).toBeNull();
  });
});
