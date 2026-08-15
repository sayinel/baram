import { describe, expect, it } from "vitest";

import {
  computeAreaCropLayout,
  MAX_AREA_CANVAS_PIXELS,
} from "../pdf-area-crop";

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
  it("displays at the scale-1 size, backed at the render target", () => {
    // 표시 200 CSS px(§276.4 그대로), 백킹은 900 device px — §276.6이 바꾼 것은
    // 두 번째 줄뿐이다.
    expect(layout()).toEqual({
      canvasHeight: 450,
      canvasWidth: 900,
      cssHeight: 100,
      cssWidth: 200,
      offsetX: -225,
      offsetY: -135,
      renderScale: 4.5,
    });
  });

  it("never enlarges the DISPLAY size of a region narrower than maxCssWidth", () => {
    // 40 CSS px wide with a 640 px budget: it is still shown at 40 CSS px…
    const result = layout({ height: 20, width: 40 });
    expect(result?.cssWidth).toBe(40);
    expect(result?.cssHeight).toBe(20);
    // …but drawn at the render target, so widening the reference to 60% of the
    // column shows real pixels instead of a 40px bitmap stretched 10×.
    expect(result?.renderScale).toBe(22.5);
    expect(result?.canvasWidth).toBe(900);
  });

  it("shrinks the display proportionally when wider than maxCssWidth", () => {
    const result = layout({ height: 640, maxCssWidth: 640, width: 1280 });
    expect(result?.cssWidth).toBe(640);
    expect(result?.cssHeight).toBe(320); // aspect ratio preserved
    // The backing still targets 900 CSS px, not the 640 it is displayed at.
    expect(result?.renderScale).toBe(0.703125);
    expect(result?.canvasWidth).toBe(900);
  });

  it("offsets the viewport by the NEGATED crop origin so it lands on the canvas", () => {
    // pdfjs adds offsetX/offsetY in already-scaled viewport space, so moving
    // the crop's top-left to (0,0) means -left*renderScale / -top*renderScale.
    // A positive offset would push the region further off-canvas.
    const result = layout({ dpr: 2, left: 100, top: 40 });
    expect(result?.renderScale).toBe(9);
    expect(result?.offsetX).toBe(-900);
    expect(result?.offsetY).toBe(-360);
  });

  it.each([
    ["below 1 is clamped up", 0.5, 1],
    ["1 passes through", 1, 1],
    ["2 passes through", 2, 2],
    ["above 2 is clamped down (memory ceiling)", 3, 2],
  ])("dpr %s", (_label, dpr, expected) => {
    const result = layout({ dpr });
    expect(result?.renderScale).toBe(4.5 * expected);
    expect(result?.canvasWidth).toBe(900 * expected);
    // CSS size is independent of dpr — only the backing store grows.
    expect(result?.cssWidth).toBe(200);
  });

  it("falls back to dpr 1 when devicePixelRatio is not finite", () => {
    // Math.min(Math.max(NaN, 1), 2) is NaN — clamping alone does not save us,
    // so the guard has to come first or the canvas ends up NaN-sized.
    const result = layout({ dpr: NaN });
    expect(result?.renderScale).toBe(4.5);
    expect(result?.canvasWidth).toBe(900);
  });

  it("caps the canvas by AREA, not by width", () => {
    // ‼️ 좁고 긴 크롭이 예산을 날리는 경로. 50×700을 900px 목표로 올리면
    // 18배 → 900×12,600 = 11.3M px. 면적 상한이 그것을 4M으로 되돌린다.
    const result = layout({ dpr: 1, height: 700, width: 50 });

    expect(result).not.toBeNull();
    // 예산에 "딱" 맞춘다 — 넘지도, 안전을 핑계로 필요 이상 흐려지지도 않는다.
    // 양쪽 변을 각각 반올림하므로 곱은 예산에서 픽셀 단위로 어긋날 수 있다
    // (여기서는 +0.09%). 예산은 하드 리밋이 아니라 메모리 가드다.
    const area = (result?.canvasWidth ?? 0) * (result?.canvasHeight ?? 0);
    expect(area / MAX_AREA_CANVAS_PIXELS).toBeCloseTo(1, 2);
    // 목표 스케일 18 대신 sqrt(4e6 / 35,000) ≈ 10.69.
    expect(result?.renderScale).toBeCloseTo(10.6904, 3);
    // 표시 크기는 상한과 무관하다.
    expect(result?.cssWidth).toBe(50);
    expect(result?.cssHeight).toBe(700);
  });

  it("leaves a crop that already fits the area budget untouched", () => {
    // 판별력: 상한을 무조건 적용하면 이 케이스가 흐려진다.
    const result = layout({ dpr: 1, height: 100, width: 200 });
    expect(result?.renderScale).toBe(4.5);
  });

  it("never returns a zero-size canvas (pdfjs throws on one)", () => {
    // 면적 상한이 걸린 극단적 종횡비에서만 남은 경로: 캔버스 폭은
    // sqrt(예산 * w/h)라 w/h가 6.25e-8보다 작으면 1픽셀 아래로 떨어진다.
    const result = layout({ height: 100000, width: 0.001 });
    expect(result?.canvasWidth).toBe(1);
    expect(result?.canvasHeight).toBeGreaterThanOrEqual(1);
    // ‼️ 1px 바닥은 면적 상한 **뒤에** 축별로 걸리므로, 여기를 보지 않으면
    // 이 입력이 만드는 1 × 20,000,000 캔버스(예산의 5배, ~80MB)를 그냥
    // 지나친다 — 방문하고도 쳐다보지 않는 테스트가 된다.
    expect(
      (result?.canvasWidth ?? 0) * (result?.canvasHeight ?? 0),
    ).toBeLessThanOrEqual(MAX_AREA_CANVAS_PIXELS * 1.01);
  });

  it("does not shrink the other axis when a floored axis is harmless", () => {
    // 클램프의 반대 가지 — 여기서는 면적 상한이 걸리지도 않는다(900 × 1).
    // 바닥이 걸렸다는 이유만으로 멀쩡한 축까지 줄이면 크롭이 잘려 나간다.
    // (두 축이 동시에 바닥을 칠 수는 없다: 상한이 걸리면 두 축의 곱이 정확히
    // 예산이므로 둘 다 1.5 미만일 수 없다.)
    const result = layout({ height: 0.001, width: 100000 });

    expect(result?.canvasHeight).toBe(1);
    expect(result?.canvasWidth).toBe(900);
  });

  // ‼️ 판별력: 이 케이스들은 `Number.isFinite` 가드를 `typeof === "number"`나
  // 크기 비교만으로 바꾸면 전부 통과해 버린다 — NaN도 Infinity도 typeof는
  // "number"이고, NaN은 어떤 크기 비교에도 걸리지 않기 때문이다.
  //
  // NaN과 Infinity를 **둘 다** 넣는 이유: 실제 도달 경로가 그 둘을 섞어서
  // 만든다. 사이드카의 `1e400`이 JSON.parse에서 Infinity가 되고(JSON에는 NaN
  // 리터럴이 없다), isPdfRect의 typeof 검사가 그걸 통과시키고, pdfjs의
  // convertToViewportPoint가 90도 배수 회전 행렬의 0 성분과 곱해
  // `0 * Infinity = NaN`을 만든다 — 자세한 근거는 pdf-area-crop.ts의 doc comment.
  it.each([
    ["NaN width", { width: NaN }],
    ["NaN height", { height: NaN }],
    ["NaN left", { left: NaN }],
    ["NaN top", { top: NaN }],
    ["Infinite width", { width: Infinity }],
    ["Infinite height", { height: Infinity }],
    ["Infinite left", { left: Infinity }],
    ["Infinite top", { top: Infinity }],
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
