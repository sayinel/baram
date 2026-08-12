import type { PdfRect } from "../pdf-highlight-geom";

import { describe, expect, it } from "vitest";

import { findPageForNode, hitTestRects } from "../pdf-highlight-hittest";

describe("hitTestRects", () => {
  const rect: PdfRect = { h: 10, w: 20, x: 100, y: 200 };

  it("hits a point inside a single rect", () => {
    expect(hitTestRects([rect], { x: 110, y: 205 })).toBe(true);
  });

  it("misses a point outside every rect", () => {
    expect(hitTestRects([rect], { x: 500, y: 500 })).toBe(false);
  });

  it("misses a point in the gap between two rects of a multi-rect highlight", () => {
    // 두 줄에 걸친 하이라이트: 첫 줄 y=[200,210], 둘째 줄 y=[230,240] —
    // 그 사이(y=220)는 x가 두 rect의 범위 안에 있어도 어느 rect에도 안 들어가야 한다.
    const wrapped: PdfRect[] = [
      { h: 10, w: 100, x: 0, y: 200 },
      { h: 10, w: 80, x: 0, y: 230 },
    ];
    expect(hitTestRects(wrapped, { x: 50, y: 220 })).toBe(false);
  });

  it("hits either rect of a multi-rect highlight on its own line", () => {
    const wrapped: PdfRect[] = [
      { h: 10, w: 100, x: 0, y: 200 },
      { h: 10, w: 80, x: 0, y: 230 },
    ];
    expect(hitTestRects(wrapped, { x: 50, y: 235 })).toBe(true);
  });

  it("treats every edge as inclusive", () => {
    expect(hitTestRects([rect], { x: 100, y: 200 })).toBe(true); // top-left corner
    expect(hitTestRects([rect], { x: 120, y: 210 })).toBe(true); // bottom-right corner
  });

  it("misses just past an edge", () => {
    expect(hitTestRects([rect], { x: 99.999, y: 205 })).toBe(false);
    expect(hitTestRects([rect], { x: 120.001, y: 205 })).toBe(false);
  });

  it("misses everything when there are no rects", () => {
    expect(hitTestRects([], { x: 0, y: 0 })).toBe(false);
  });
});

describe("findPageForNode", () => {
  function makePageEl(): HTMLElement {
    const el = document.createElement("div");
    const child = document.createElement("span");
    el.appendChild(child);
    return el;
  }

  it("finds the page whose element contains the node", () => {
    const page1 = makePageEl();
    const page2 = makePageEl();
    const pageEls = new Map([
      [1, page1],
      [2, page2],
    ]);
    const target = page2.firstChild;

    expect(findPageForNode(pageEls, target)).toEqual({
      el: page2,
      pageNumber: 2,
    });
  });

  it("returns null when no registered page contains the node", () => {
    const page1 = makePageEl();
    const pageEls = new Map([[1, page1]]);
    const stray = document.createElement("span");

    expect(findPageForNode(pageEls, stray)).toBeNull();
  });

  it("returns null for a null node", () => {
    expect(findPageForNode(new Map(), null)).toBeNull();
  });
});
