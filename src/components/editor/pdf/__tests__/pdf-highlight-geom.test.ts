import type { ViewportLike } from "../pdf-highlight-geom";

import { describe, expect, it } from "vitest";

import { clientRectToPdf, pdfRectToPageLocal } from "../pdf-highlight-geom";

/**
 * 뷰포트 대역. pdfjs PageViewport를 직접 만들 수 없으므로
 * (PDFPageProxy가 필요하다) 가역 아핀 변환으로 대신한다.
 * 왕복 항등만 단정하므로 이 대역이 pdfjs와 달라도 결론은 유효하다.
 */
function makeViewport(
  scale: number,
  rotate: 0 | 90,
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
  // 90도 회전 — x와 y가 뒤바뀐다
  return {
    convertToPdfPoint: (x, y) => [y / scale, x / scale],
    convertToViewportPoint: (x, y) => [y * scale, x * scale],
  };
}

const PAGE_ORIGIN = { left: 120, top: 64 };

describe("coordinate round-trip", () => {
  it.each([
    ["scale 1", 1, 0 as const],
    ["scale 2.5", 2.5, 0 as const],
    ["scale 0.5", 0.5, 0 as const],
    ["rotated 90", 1.5, 90 as const],
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

  it("always produces non-negative width and height", () => {
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
});
