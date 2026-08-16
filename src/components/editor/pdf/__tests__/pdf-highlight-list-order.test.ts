// §282.2 목록 순서 — 뷰포트 공간 정렬(회전 페이지 포함).
import type { PdfRect, ViewportLike } from "../pdf-highlight-geom";
import type { StoredHighlight } from "../pdf-highlight-sidecar";

import { describe, expect, it } from "vitest";

import {
  boundingPdfRect,
  sortHighlightsForList,
} from "../pdf-highlight-list-order";

/** 회전 없는 US Letter — 화면 top은 y축이 뒤집힌 값이다. */
const upright: ViewportLike = {
  convertToPdfPoint: (x, y) => [x, 792 - y],
  convertToViewportPoint: (x, y) => [x, 792 - y],
};

/**
 * /Rotate 90 — user space의 +x가 화면의 아래 방향이 된다. 즉 화면의 위→아래
 * 순서는 user space의 **x** 오름차순이고 y와는 무관하다. 저장된 기하가 회전
 * 독립적이라(§274) 이런 페이지가 실제로 존재한다.
 */
const rotated90: ViewportLike = {
  convertToPdfPoint: (x, y) => [y, x],
  convertToViewportPoint: (x, y) => [y, x],
};

const rotatedPages = () => rotated90;

const uprightPages = () => upright;

function hl(
  id: string,
  page: number,
  rects: PdfRect[],
  kind: "area" | "text" = "text",
): StoredHighlight {
  return { color: "yellow", id, kind, page, rects };
}

/** y는 아래 모서리다 — user space에서 y가 클수록 페이지 위쪽이다. */
function rect(x: number, y: number, w = 100, h = 10): PdfRect {
  return { h, w, x, y };
}

describe("boundingPdfRect", () => {
  it("wraps every rect of a multi-line text highlight", () => {
    expect(boundingPdfRect([rect(10, 700), rect(20, 680, 150)])).toEqual({
      h: 30,
      w: 160,
      x: 10,
      y: 680,
    });
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
    const out = sortHighlightsForList(
      [
        hl("c", 3, [rect(0, 700)]),
        hl("a", 1, [rect(0, 700)]),
        hl("b", 2, [rect(0, 700)]),
      ],
      uprightPages,
    );
    expect(out.map((h) => h.id)).toEqual(["a", "b", "c"]);
  });

  // PDF user space는 y가 위로 증가하고 저장된 y는 아래 모서리라, 페이지 위쪽
  // 하이라이트일수록 y가 크다. 뷰포트로 옮기면 그 뒤집힘이 사라져 top
  // 오름차순이 곧 위에서 아래다.
  it("orders top-of-page first within a page, not bottom-first", () => {
    const out = sortHighlightsForList(
      [
        hl("bottom", 1, [rect(0, 80)]),
        hl("top", 1, [rect(0, 700)]),
        hl("middle", 1, [rect(0, 400)]),
      ],
      uprightPages,
    );
    expect(out.map((h) => h.id)).toEqual(["top", "middle", "bottom"]);
  });

  // 높이가 다르면 "아래 모서리"와 "위 모서리" 기준의 순서가 갈린다.
  it("compares the TOP edge, so a tall highlight does not jump the queue", () => {
    const out = sortHighlightsForList(
      [
        hl("tall", 1, [rect(0, 300, 100, 100)]), // user y 300..400
        hl("short", 1, [rect(0, 450, 100, 10)]), // user y 450..460 (더 위)
      ],
      uprightPages,
    );
    expect(out.map((h) => h.id)).toEqual(["short", "tall"]);
  });

  // ‼️ 리뷰 M2. 저장된 기하는 일부러 회전 독립적이라, /Rotate 90 페이지에서는
  // 화면의 위→아래가 user space의 다른 축이다. user space y로 정렬하던 첫 판은
  // 이런 페이지에서 목록을 화면상 좌→우 순서로 내놨다. 이 픽스처는 두 규칙을
  // 구분한다 — user space y로 정렬하면 결과가 뒤집힌다.
  it("follows the SCREEN order on a rotated page, not the user-space axis", () => {
    const out = sortHighlightsForList(
      [
        // 회전 뷰포트에서 화면 top = user x. lower가 화면 아래다.
        hl("lower", 1, [rect(500, 100)]),
        hl("upper", 1, [rect(50, 700)]),
      ],
      rotatedPages,
    );
    expect(out.map((h) => h.id)).toEqual(["upper", "lower"]);
  });

  it("falls back to the screen left edge for side-by-side highlights", () => {
    const out = sortHighlightsForList(
      [hl("right", 1, [rect(300, 700)]), hl("left", 1, [rect(50, 700)])],
      uprightPages,
    );
    expect(out.map((h) => h.id)).toEqual(["left", "right"]);
  });

  // 페이지 프록시가 아직 없으면(문서 로드 직후) 앵커를 못 만든다 — 그때는
  // 페이지 번호만으로 정렬하고 던지지 않는다.
  it("still orders by page when no viewport is available yet", () => {
    const out = sortHighlightsForList(
      [hl("b", 2, [rect(0, 700)]), hl("a", 1, [rect(0, 700)])],
      () => null,
    );
    expect(out.map((h) => h.id)).toEqual(["a", "b"]);
  });

  it("does not mutate the sidecar's array", () => {
    const input = [hl("b", 2, [rect(0, 700)]), hl("a", 1, [rect(0, 700)])];
    sortHighlightsForList(input, uprightPages);
    expect(input.map((h) => h.id)).toEqual(["b", "a"]);
  });
});
