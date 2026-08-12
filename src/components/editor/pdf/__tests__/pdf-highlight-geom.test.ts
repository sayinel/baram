import type { DOMRectLike, ViewportLike } from "../pdf-highlight-geom";

import { describe, expect, it } from "vitest";

import {
  clientRectToPdf,
  mergeRectsByLine,
  pdfRectToPageLocal,
} from "../pdf-highlight-geom";

/**
 * 뷰포트 대역. pdfjs PageViewport를 직접 만들 수 없으므로
 * (PDFPageProxy가 필요하다) 가역 아핀 변환으로 대신한다.
 * 왕복 항등만 단정하므로 이 대역이 pdfjs와 달라도 결론은 유효하다.
 */
function makeViewport(
  scale: number,
  rotate: 0 | 90 | 180,
  pageHeight = 800,
): ViewportLike {
  if (rotate === 0) {
    // PDF는 y축이 위로, 화면은 아래로 — 뒤집힌다
    return {
      convertToPdfPoint: (x, y) => [
        x / scale,
        (pageHeight * scale - y) / scale,
      ],
      convertToViewportPoint: (x, y) => [
        x * scale,
        pageHeight * scale - y * scale,
      ],
    };
  }
  if (rotate === 90) {
    // 90도 회전 — x와 y가 뒤바뀐다
    return {
      convertToPdfPoint: (x, y) => [y / scale, x / scale],
      convertToViewportPoint: (x, y) => [y * scale, x * scale],
    };
  }
  // 180도 회전 — x축이 뒤집힌다 (px0 > px1 상황 유발)
  const pageWidth = 612; // standard letter width in points
  return {
    convertToPdfPoint: (x, y) => [
      (pageWidth * scale - x) / scale,
      (pageHeight * scale - y) / scale,
    ],
    convertToViewportPoint: (x, y) => [
      pageWidth * scale - x * scale,
      pageHeight * scale - y * scale,
    ],
  };
}

const PAGE_ORIGIN = { left: 120, top: 64 };

describe("coordinate round-trip", () => {
  it.each([
    ["scale 1", 1, 0 as const],
    ["scale 2.5", 2.5, 0 as const],
    ["scale 0.5", 0.5, 0 as const],
    ["rotated 90", 1.5, 90 as const],
    ["rotated 180 (reflecting)", 1.5, 180 as const],
  ])("survives client → pdf → page-local: %s", (_label, scale, rotate) => {
    const viewport = makeViewport(scale, rotate);
    const clientRect = {
      height: 14 * scale,
      left: PAGE_ORIGIN.left + 40 * scale,
      top: PAGE_ORIGIN.top + 200 * scale,
      width: 180 * scale,
    };

    const pdfRect = clientRectToPdf(clientRect, PAGE_ORIGIN, viewport);
    const back = pdfRectToPageLocal(pdfRect, viewport);

    // 페이지 로컬 좌표로 돌아오므로 원점을 뺀 값과 같아야 한다
    expect(back.left).toBeCloseTo(clientRect.left - PAGE_ORIGIN.left, 6);
    expect(back.top).toBeCloseTo(clientRect.top - PAGE_ORIGIN.top, 6);
    expect(back.width).toBeCloseTo(clientRect.width, 6);
    expect(back.height).toBeCloseTo(clientRect.height, 6);
  });

  it("clientRectToPdf always produces non-negative width and height", () => {
    // y축이 뒤집히는 변환에서 min/abs를 빠뜨리면 음수가 나온다
    const viewport = makeViewport(1, 0);
    const pdfRect = clientRectToPdf(
      { height: 14, left: PAGE_ORIGIN.left, top: PAGE_ORIGIN.top, width: 100 },
      PAGE_ORIGIN,
      viewport,
    );

    expect(pdfRect.w).toBeGreaterThan(0);
    expect(pdfRect.h).toBeGreaterThan(0);
  });

  it("pdfRectToPageLocal always produces non-negative width and height", () => {
    // 180도 회전에서 x축이 뒤집히는 변환을 거쳐도 음수가 나오지 않아야 한다
    const viewport = makeViewport(1, 180);
    const pdfRect = { x: 100, y: 100, w: 200, h: 50 };

    const back = pdfRectToPageLocal(pdfRect, viewport);

    expect(back.width).toBeGreaterThan(0);
    expect(back.height).toBeGreaterThan(0);
  });
});

describe("mergeRectsByLine", () => {
  it("returns an empty array for an empty input", () => {
    expect(mergeRectsByLine([])).toEqual([]);
  });

  it("leaves a single rect untouched", () => {
    const r: DOMRectLike = { height: 12, left: 10, top: 20, width: 50 };
    expect(mergeRectsByLine([r])).toEqual([r]);
  });

  it("merges two same-line fragments with a gap between them into one spanning rect (closes the hole)", () => {
    // 같은 줄, 겹치는 top/height, 사이 여백(60~100)이 있다 — pdf.js가
    // 아이템마다 만드는 별도 span 두 개를 흉내낸 것.
    const word1: DOMRectLike = { height: 14, left: 0, top: 100, width: 60 };
    const word2: DOMRectLike = { height: 14, left: 100, top: 100, width: 40 };

    const merged = mergeRectsByLine([word1, word2]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({ height: 14, left: 0, top: 100, width: 140 });
  });

  it("does not merge rects on visually distinct lines", () => {
    const line1: DOMRectLike = { height: 14, left: 0, top: 100, width: 60 };
    const line2: DOMRectLike = { height: 14, left: 0, top: 130, width: 60 };

    const merged = mergeRectsByLine([line1, line2]);

    expect(merged).toHaveLength(2);
  });

  it("merges items whose heights differ but whose vertical centers overlap (e.g. a superscript sharing a line with body text)", () => {
    const body: DOMRectLike = { height: 14, left: 0, top: 100, width: 60 };
    // 위첨자 — 살짝 위로 붙지만 body의 [100,114] 구간 안에 중심이 들어간다
    const superscript: DOMRectLike = {
      height: 8,
      left: 60,
      top: 98,
      width: 10,
    };

    const merged = mergeRectsByLine([body, superscript]);

    expect(merged).toHaveLength(1);
    expect(merged[0].left).toBe(0);
    expect(merged[0].width).toBe(70);
  });

  it("merges transitively across three overlapping fragments regardless of input order", () => {
    const a: DOMRectLike = { height: 14, left: 0, top: 100, width: 20 };
    const b: DOMRectLike = { height: 14, left: 30, top: 100, width: 20 };
    const c: DOMRectLike = { height: 14, left: 60, top: 100, width: 20 };

    // 순서를 뒤섞어도 결과가 같아야 한다 — 정렬 뒤 순차 병합이므로.
    const merged = mergeRectsByLine([c, a, b]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({ height: 14, left: 0, top: 100, width: 80 });
  });

  it("keeps a trailing overhanging fragment's right edge as-is (merging only closes gaps, it never trims)", () => {
    // "overhang" 자체(부분 선택된 아이템의 스케일 보정 오차)는 이 함수의
    // 책임이 아니다 — 병합은 같은 줄의 왼쪽/오른쪽 최댓값을 취할 뿐 절대
    // 축소하지 않는다. 이 테스트는 그 경계를 고정한다.
    const word1: DOMRectLike = { height: 14, left: 0, top: 100, width: 60 };
    const overhanging: DOMRectLike = {
      height: 14,
      left: 60,
      top: 100,
      width: 55, // 실제 글리프보다 5px 더 넓다고 가정
    };

    const merged = mergeRectsByLine([word1, overhanging]);

    expect(merged).toHaveLength(1);
    expect(merged[0].width).toBe(115);
  });
});
