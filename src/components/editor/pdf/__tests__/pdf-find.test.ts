import { describe, expect, it } from "vitest";

import { convertMatches } from "../pdf-find";

describe("convertMatches", () => {
  // 누적 인덱스:  "Hello "=0..5  "world"=6..10  " again"=11..16
  const items = ["Hello ", "world", " again"];

  it("maps a match inside a single div", () => {
    // "world" @ 6, length 5
    expect(convertMatches([6], [5], items)).toEqual([
      { begin: { divIdx: 1, offset: 0 }, end: { divIdx: 1, offset: 5 } },
    ]);
  });

  it("maps a match spanning two divs", () => {
    // "lo wo" @ 3, length 5 → div0 offset 3 ~ div1 offset 2
    expect(convertMatches([3], [5], items)).toEqual([
      { begin: { divIdx: 0, offset: 3 }, end: { divIdx: 1, offset: 2 } },
    ]);
  });

  it("maps multiple ascending matches", () => {
    expect(convertMatches([0, 11], [5, 6], items)).toEqual([
      { begin: { divIdx: 0, offset: 0 }, end: { divIdx: 0, offset: 5 } },
      { begin: { divIdx: 2, offset: 0 }, end: { divIdx: 2, offset: 6 } },
    ]);
  });

  it("clamps a match that ends at the last div", () => {
    // " again" @ 11, length 6 — 마지막 div 끝
    expect(convertMatches([11], [6], items)).toEqual([
      { begin: { divIdx: 2, offset: 0 }, end: { divIdx: 2, offset: 6 } },
    ]);
  });

  it("returns empty for no matches or no items", () => {
    expect(convertMatches([], [], items)).toEqual([]);
    expect(convertMatches([0], [1], [])).toEqual([]);
  });
});
