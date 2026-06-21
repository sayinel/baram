import { describe, expect, it } from "vitest";

import {
  computeBand,
  computeDelta,
  computeSpacers,
  HeightMap,
} from "../viewport-virtualize-geometry";

describe("HeightMap", () => {
  it("estimates uniformly before measurement", () => {
    const hm = new HeightMap();
    hm.reset(["a", "b", "c"], 20);
    expect(hm.length).toBe(3);
    expect(hm.heightAt(1)).toBe(20);
    expect(hm.offsetAt(0)).toBe(0);
    expect(hm.offsetAt(2)).toBe(40);
    expect(hm.totalHeight).toBe(60);
  });

  it("uses measured heights and recomputes offsets", () => {
    const hm = new HeightMap();
    hm.reset(["a", "b", "c"], 20);
    hm.setHeight(0, 100);
    hm.setHeight(1, 50);
    expect(hm.offsetAt(0)).toBe(0);
    expect(hm.offsetAt(1)).toBe(100);
    expect(hm.offsetAt(2)).toBe(150);
    expect(hm.totalHeight).toBe(170); // 100 + 50 + 20(estimate)
  });

  it("binary-searches the block at a vertical offset", () => {
    const hm = new HeightMap();
    hm.reset(["a", "b", "c", "d"], 100); // offsets 0,100,200,300
    expect(hm.indexAtOffset(0)).toBe(0);
    expect(hm.indexAtOffset(99)).toBe(0);
    expect(hm.indexAtOffset(100)).toBe(1);
    expect(hm.indexAtOffset(250)).toBe(2);
    expect(hm.indexAtOffset(99999)).toBe(3); // clamps to last
  });

  it("preserves measured heights across syncKeys when keys persist", () => {
    const hm = new HeightMap();
    hm.reset(["a", "b", "c"], 20);
    hm.setHeight(1, 80); // measure "b"
    hm.syncKeys(["a", "x", "b", "c"], 20); // "x" inserted before "b"
    expect(hm.length).toBe(4);
    const bIndex = 2;
    expect(hm.heightAt(bIndex)).toBe(80); // "b" kept its measured height
    expect(hm.heightAt(1)).toBe(20); // "x" is a fresh estimate
  });
});

describe("computeBand", () => {
  const hm = new HeightMap();
  hm.reset(["a", "b", "c", "d", "e", "f"], 100); // offsets 0,100,...,500; total 600

  it("returns the blocks intersecting [scrollTop-buffer, scrollTop+vh+buffer]", () => {
    // viewport 200..400, buffer 0 → blocks at offsets [200,300] → indices 2,3
    expect(computeBand(200, 200, 0, hm)).toEqual({ first: 2, last: 3 });
  });

  it("expands by buffer", () => {
    // viewport 200..400, buffer 100 → 100..500 → indices 1..4
    expect(computeBand(200, 200, 100, hm)).toEqual({ first: 1, last: 4 });
  });

  it("clamps at the top", () => {
    expect(computeBand(0, 150, 0, hm)).toEqual({ first: 0, last: 1 });
  });

  it("clamps at the bottom", () => {
    expect(computeBand(550, 200, 0, hm)).toEqual({ first: 5, last: 5 });
  });

  it("returns an empty band for an empty map", () => {
    const empty = new HeightMap();
    empty.reset([], 100);
    expect(computeBand(0, 200, 0, empty)).toEqual({ first: 0, last: -1 });
  });
});

describe("computeSpacers", () => {
  const hm = new HeightMap();
  hm.reset(["a", "b", "c", "d", "e", "f"], 100); // total 600

  it("reserves height above first and below last", () => {
    // band 2..3 → vtop = offset(2)=200; vbot = total - (offset(3)+h(3)) = 600-400 = 200
    expect(computeSpacers({ first: 2, last: 3 }, hm)).toEqual({
      vbot: 200,
      vtop: 200,
    });
  });

  it("zero spacers when whole doc visible", () => {
    expect(computeSpacers({ first: 0, last: 5 }, hm)).toEqual({
      vbot: 0,
      vtop: 0,
    });
  });

  it("zero spacers for empty band", () => {
    expect(computeSpacers({ first: 0, last: -1 }, hm)).toEqual({
      vbot: 0,
      vtop: 0,
    });
  });
});

describe("computeDelta", () => {
  it("shows the new range and hides what left it", () => {
    // prev 2..4 → next 4..6 : show 5,6 ; hide 2,3
    expect(computeDelta({ first: 2, last: 4 }, { first: 4, last: 6 })).toEqual({
      hide: [2, 3],
      show: [5, 6],
    });
  });

  it("shows the entire next band when there is no prev", () => {
    expect(computeDelta(null, { first: 1, last: 3 })).toEqual({
      hide: [],
      show: [1, 2, 3],
    });
  });

  it("no-ops on an unchanged band", () => {
    expect(computeDelta({ first: 2, last: 4 }, { first: 2, last: 4 })).toEqual({
      hide: [],
      show: [],
    });
  });
});
