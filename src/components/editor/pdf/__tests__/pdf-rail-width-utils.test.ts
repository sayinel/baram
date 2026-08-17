// §283 레일 폭의 순수 규칙 — 자르기와 콘텐츠 폭 파생.
//
// 왜 따로 고정하는가: 이 두 함수가 **네 곳**에 동시에 흐른다(CSS 변수, 본문
// fit-width, 썸네일, 영역 크롭). 하나라도 다른 값을 보면 "zoom 100%인데 가로
// 스크롤이 생긴다" 같은 조용한 증상으로만 나타난다.
import { describe, expect, it } from "vitest";

import {
  clampRailWidth,
  fitRailWidth,
  PDF_RAIL_DEFAULT_WIDTH_PX,
  PDF_RAIL_MAX_WIDTH_PX,
  PDF_RAIL_MIN_WIDTH_PX,
  railContentWidth,
} from "../../../../utils/pdf-rail-width";

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

  // ‼️ 여기서는 자르지 **않는다.** 입력은 fitRailWidth를 이미 통과한 "화면에
  // 실제로 쓰는 폭"이고, 좁은 창에서는 그것이 하한 아래일 수 있다. 다시 자르면
  // 레일 상자보다 넓은 썸네일이 그려진다.
  it("follows a fitted width below the minimum instead of clamping it back up", () => {
    expect(railContentWidth(100)).toBe(50);
  });

  // 음수 폭은 getViewport에서 뒤집힌 캔버스를 만든다.
  it("never goes negative", () => {
    expect(railContentWidth(10)).toBe(0);
    expect(railContentWidth(-50)).toBe(0);
  });

  it("stays positive at the minimum rail width", () => {
    expect(railContentWidth(PDF_RAIL_MIN_WIDTH_PX)).toBeGreaterThan(0);
  });
});

// ‼️ §283 리뷰 HIGH-1. 폭이 **영속되므로** 넓은 창에서 끌어 둔 420px이 좁은 창
// 세션으로 따라온다. 그대로 쓰면 availableFitWidth가 음수가 되어 baseScale이
// 0으로 남고, pagesReady가 false가 되어 페이지·툴바·레일이 전부 사라진다 —
// 레일 토글조차 없으니 앱 안에서는 되돌릴 수 없다.
describe("fitRailWidth", () => {
  it("leaves the stored width alone when there is room", () => {
    expect(fitRailWidth(PDF_RAIL_MAX_WIDTH_PX, 1600)).toBe(
      PDF_RAIL_MAX_WIDTH_PX,
    );
  });

  // 아직 못 쟀을 때 0을 그대로 믿으면 첫 렌더에서 레일이 접힌다.
  it("trusts the stored width while the container is unmeasured", () => {
    expect(fitRailWidth(300, 0)).toBe(300);
  });

  it("shrinks the rail so the page keeps a minimum width", () => {
    // 사이드바 + 우측 패널을 연 640px 창의 편집 영역.
    const fitted = fitRailWidth(PDF_RAIL_MAX_WIDTH_PX, 332);
    expect(fitted).toBeLessThan(PDF_RAIL_MAX_WIDTH_PX);
    expect(332 - 24 * 2 - fitted).toBeGreaterThan(0);
  });

  // 하한 아래로 내려가도 된다 — 그 대안이 아무것도 안 보이는 화면이다.
  it("may go below the minimum rather than blank the viewer", () => {
    const fitted = fitRailWidth(PDF_RAIL_MAX_WIDTH_PX, 240);
    expect(fitted).toBeLessThan(PDF_RAIL_MIN_WIDTH_PX);
    expect(fitted).toBeGreaterThanOrEqual(0);
  });

  it("never returns a negative width", () => {
    expect(fitRailWidth(PDF_RAIL_MAX_WIDTH_PX, 40)).toBe(0);
  });

  // 줄이는 것은 표시일 뿐이다 — 저장값은 그대로이므로 창을 넓히면 돌아온다.
  it("restores the stored width once the container grows back", () => {
    expect(fitRailWidth(PDF_RAIL_MAX_WIDTH_PX, 332)).toBeLessThan(
      PDF_RAIL_MAX_WIDTH_PX,
    );
    expect(fitRailWidth(PDF_RAIL_MAX_WIDTH_PX, 1600)).toBe(
      PDF_RAIL_MAX_WIDTH_PX,
    );
  });
});
