import type { PdfRect } from "../pdf-highlight-geom";
import type { StoredHighlight } from "../pdf-highlight-sidecar";

// §282.2 목록 순서 — PDF y축(위로 증가)이 만드는 함정.
import { describe, expect, it } from "vitest";

import {
  boundingPdfRect,
  sortHighlightsForList,
} from "../pdf-highlight-list-order";

function hl(
  id: string,
  page: number,
  rects: PdfRect[],
  kind: "area" | "text" = "text",
): StoredHighlight {
  return { color: "yellow", id, kind, page, rects };
}

/** y는 아래 모서리다 — y가 클수록 페이지 **위쪽**이다. */
function rect(x: number, y: number, w = 100, h = 10): PdfRect {
  return { h, w, x, y };
}

describe("boundingPdfRect", () => {
  it("wraps every rect of a multi-line text highlight", () => {
    const b = boundingPdfRect([rect(10, 700), rect(20, 680, 150)]);
    expect(b).toEqual({ h: 30, w: 160, x: 10, y: 680 });
  });

  it("returns the rect itself for a single-rect area highlight", () => {
    expect(boundingPdfRect([rect(5, 100, 40, 30)])).toEqual({
      h: 30,
      w: 40,
      x: 5,
      y: 100,
    });
  });

  // 사이드카 검증기가 rects.length > 0을 요구하지만, 그 검증을 신뢰해
  // -Infinity 상자를 돌려주면 정렬이 조용히 뒤집힌다.
  it("returns null for an empty rect list instead of an infinite box", () => {
    expect(boundingPdfRect([])).toBeNull();
  });
});

describe("sortHighlightsForList", () => {
  it("orders by page first", () => {
    const out = sortHighlightsForList([
      hl("c", 3, [rect(0, 700)]),
      hl("a", 1, [rect(0, 700)]),
      hl("b", 2, [rect(0, 700)]),
    ]);
    expect(out.map((h) => h.id)).toEqual(["a", "b", "c"]);
  });

  // ‼️ 이 파일의 존재 이유. PDF는 y가 위로 증가하고 저장된 y는 아래 모서리라,
  // 페이지 위쪽 하이라이트일수록 y가 크다. y 오름차순으로 정렬하면 페이지마다
  // 정확히 역순이 된다 — 즉 "위에서 아래로"는 y **내림차순**이다.
  it("orders top-of-page first within a page, not bottom-first", () => {
    const top = hl("top", 1, [rect(0, 700)]);
    const middle = hl("middle", 1, [rect(0, 400)]);
    const bottom = hl("bottom", 1, [rect(0, 80)]);

    const out = sortHighlightsForList([bottom, top, middle]);

    expect(out.map((h) => h.id)).toEqual(["top", "middle", "bottom"]);
  });

  // 높이가 다르면 "아래 모서리(y)"와 "위 모서리(y+h)"의 순서가 갈린다 —
  // 이 픽스처가 두 규칙을 구분한다. y로 정렬하면 tall이 먼저 온다.
  it("compares the TOP edge, so a tall highlight does not jump the queue", () => {
    const tall = hl("tall", 1, [rect(0, 300, 100, 100)]); // 아래 300, 위 400
    const shortHigher = hl("short", 1, [rect(0, 450, 100, 10)]); // 아래 450, 위 460

    const out = sortHighlightsForList([tall, shortHigher]);

    expect(out.map((h) => h.id)).toEqual(["short", "tall"]);
  });

  it("falls back to x so side-by-side highlights keep a stable order", () => {
    const right = hl("right", 1, [rect(300, 700)]);
    const left = hl("left", 1, [rect(50, 700)]);

    expect(sortHighlightsForList([right, left]).map((h) => h.id)).toEqual([
      "left",
      "right",
    ]);
  });

  it("does not mutate the sidecar's array", () => {
    const input = [hl("b", 2, [rect(0, 700)]), hl("a", 1, [rect(0, 700)])];
    sortHighlightsForList(input);
    expect(input.map((h) => h.id)).toEqual(["b", "a"]);
  });
});
