// §283 레일 폭의 순수 규칙 — 자르기와 콘텐츠 폭 파생.
//
// 왜 따로 고정하는가: 이 두 함수가 **네 곳**에 동시에 흐른다(CSS 변수, 본문
// fit-width, 썸네일, 영역 크롭). 하나라도 다른 값을 보면 "zoom 100%인데 가로
// 스크롤이 생긴다" 같은 조용한 증상으로만 나타난다.
import { describe, expect, it } from "vitest";

import {
  clampRailWidth,
  PDF_RAIL_DEFAULT_WIDTH_PX,
  PDF_RAIL_MAX_WIDTH_PX,
  PDF_RAIL_MIN_WIDTH_PX,
  railContentWidth,
} from "../pdf-side-panel-utils";

describe("clampRailWidth", () => {
  it("leaves a width inside the range untouched", () => {
    expect(clampRailWidth(240)).toBe(240);
  });

  it.each([
    ["below the minimum", 10, PDF_RAIL_MIN_WIDTH_PX],
    ["above the maximum", 10_000, PDF_RAIL_MAX_WIDTH_PX],
    ["negative", -300, PDF_RAIL_MIN_WIDTH_PX],
  ])("clamps a width %s", (_label, input, expected) => {
    expect(clampRailWidth(input)).toBe(expected);
  });

  it("rounds to whole pixels", () => {
    expect(clampRailWidth(240.6)).toBe(241);
  });

  // 설정 파일이 손상됐거나 구버전이 남긴 값이 흘러들 수 있다. NaN이 그대로
  // 지나가면 CSS 변수가 "NaNpx"가 되어 레일이 폭 0으로 접힌다.
  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ])("falls back to the default for %s", (_label, input) => {
    expect(clampRailWidth(input)).toBe(PDF_RAIL_DEFAULT_WIDTH_PX);
  });

  // 하한이 상한보다 커지면 clamp의 두 항이 서로를 뒤집는다.
  it("keeps the range coherent", () => {
    expect(PDF_RAIL_MIN_WIDTH_PX).toBeLessThan(PDF_RAIL_MAX_WIDTH_PX);
    expect(PDF_RAIL_DEFAULT_WIDTH_PX).toBeGreaterThanOrEqual(
      PDF_RAIL_MIN_WIDTH_PX,
    );
    expect(PDF_RAIL_DEFAULT_WIDTH_PX).toBeLessThanOrEqual(
      PDF_RAIL_MAX_WIDTH_PX,
    );
  });
});

describe("railContentWidth", () => {
  it("tracks the rail width", () => {
    expect(railContentWidth(300) - railContentWidth(200)).toBe(100);
  });

  it("leaves room for the rail's own padding", () => {
    expect(railContentWidth(200)).toBeLessThan(200);
  });

  // ‼️ 자르기를 거친다. 안 그러면 저장된 값이 범위 밖일 때 썸네일 폭이
  // 레일보다 넓어지거나 음수가 된다 — 음수 폭은 getViewport에서 뒤집힌
  // 캔버스를 만든다.
  it("clamps its input, so a bad stored width cannot leak through", () => {
    expect(railContentWidth(10_000)).toBe(
      railContentWidth(PDF_RAIL_MAX_WIDTH_PX),
    );
    expect(railContentWidth(-50)).toBe(railContentWidth(PDF_RAIL_MIN_WIDTH_PX));
  });

  it("stays positive across the whole range", () => {
    expect(railContentWidth(PDF_RAIL_MIN_WIDTH_PX)).toBeGreaterThan(0);
  });
});
