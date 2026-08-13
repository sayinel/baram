import type { PdfRect } from "../pdf-highlight-geom";

import { describe, expect, it } from "vitest";

import {
  findPageForNode,
  hitTestRects,
  hitTestTopmost,
} from "../pdf-highlight-hittest";

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

// §274 UX fix round 5 — 겹친 하이라이트 클릭은 "가장 나중에 생성된(=화면에서
// 맨 위)" 것을 잡아야 한다. PdfPage.tsx는 highlights 배열을 그대로
// `.map()`해 그리므로(정렬 없음) 배열 마지막 항목이 맨 위에 그려진다 —
// pdf-page.test.tsx의 "paints in array order" 테스트가 그 절반을 고정하고,
// 여기 아래 테스트들이 나머지 절반("그 순서를 거꾸로 훑어 히트 테스트한다")을
// 고정한다. 둘 중 하나만 바뀌면 반대쪽 테스트가 깨진다.
describe("hitTestTopmost", () => {
  const overlapping = [
    { id: "first", rects: [{ h: 20, w: 100, x: 0, y: 0 }] },
    { id: "second", rects: [{ h: 20, w: 100, x: 0, y: 0 }] },
    { id: "third", rects: [{ h: 20, w: 100, x: 0, y: 0 }] },
  ];

  it("returns the most recently created (last array) highlight when several overlap", () => {
    expect(hitTestTopmost(overlapping, { x: 10, y: 10 })?.id).toBe("third");
  });

  it("returns the only covering highlight for a non-overlapping click", () => {
    const highlights = [
      { id: "a", rects: [{ h: 10, w: 10, x: 0, y: 0 }] },
      { id: "b", rects: [{ h: 10, w: 10, x: 200, y: 200 }] },
    ];
    expect(hitTestTopmost(highlights, { x: 205, y: 205 })?.id).toBe("b");
  });

  it("returns null when the click misses every highlight", () => {
    expect(hitTestTopmost(overlapping, { x: 500, y: 500 })).toBeNull();
  });

  it("returns null for an empty highlight list", () => {
    expect(hitTestTopmost([], { x: 0, y: 0 })).toBeNull();
  });

  // §276.3 hitTestTopmost is generic over `{ rects }` and never reads
  // `kind` — an area highlight participates exactly like a text one,
  // including in the "topmost wins" tie-break. Mixing kinds here pins that
  // no kind-specific branching crept in.
  it("picks the topmost regardless of whether it's a text or area highlight", () => {
    const mixed = [
      {
        id: "text-1",
        kind: "text" as const,
        rects: [{ h: 20, w: 100, x: 0, y: 0 }],
      },
      {
        id: "area-1",
        kind: "area" as const,
        rects: [{ h: 20, w: 100, x: 0, y: 0 }],
      },
    ];
    expect(hitTestTopmost(mixed, { x: 10, y: 10 })?.id).toBe("area-1");

    const reversed = [mixed[1], mixed[0]];
    expect(hitTestTopmost(reversed, { x: 10, y: 10 })?.id).toBe("text-1");
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
