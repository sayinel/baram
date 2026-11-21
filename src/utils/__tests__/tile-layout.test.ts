import type { TileSetTiles } from "../../ipc/image-tiles";

import { describe, expect, test } from "vitest";

import {
  chooseLevel,
  layoutTiles,
  layoutTilesAtLevel,
} from "../image-tiles/tile-layout";

const SET: TileSetTiles = {
  bytes: 0,
  dir: "/c/k",
  ext: "jpg",
  height: 12240,
  kind: "tiles",
  levels: [
    { h: 12240, w: 16320 },
    { h: 6120, w: 8160 },
    { h: 3060, w: 4080 },
    { h: 1530, w: 2040 },
    { h: 765, w: 1020 },
    { h: 383, w: 510 },
  ],
  tile: 512,
  width: 16320,
};

const FULL_BASE = { height: 826.5, left: 0, top: 0, width: 1102 };
const FULL_VIEW = { height: 900, left: 0, top: 0, width: 1200 };

test("chooseLevel picks the coarsest level not coarser than device pixels", () => {
  expect(chooseLevel(16320, 6, 2204)).toBe(2);
  expect(chooseLevel(16320, 6, 4408)).toBe(1);
  expect(chooseLevel(16320, 6, 8816)).toBe(0);
  expect(chooseLevel(16320, 6, 17632)).toBe(0);
  expect(chooseLevel(16320, 6, 1102)).toBe(3);
  expect(chooseLevel(16320, 6, 100)).toBe(5);
  expect(chooseLevel(16320, 6, 0)).toBe(5);
});

describe("layoutTiles", () => {
  test("mounts only the tiles in view plus one tile of margin", () => {
    const out = layoutTiles(
      SET,
      { height: 12240, left: 0, top: 0, width: 16320 },
      { height: 400, left: 0, top: 0, width: 600 },
      1,
    );
    expect(out.level).toBe(0);
    expect(out.tiles.map((t) => t.key).sort()).toEqual([
      "0/0_0",
      "0/0_1",
      "0/1_0",
      "0/1_1",
      "0/2_0",
      "0/2_1",
    ]);
  });

  test("follows the scroll position", () => {
    const out = layoutTiles(
      SET,
      { height: 12240, left: -5000, top: 0, width: 16320 },
      { height: 400, left: 0, top: 0, width: 600 },
      1,
    );
    expect(
      [...new Set(out.tiles.map((t) => t.col))].sort((a, b) => a - b),
    ).toEqual([8, 9, 10, 11]);
  });

  test("neighbouring tiles share their snapped edge and the last edge is the base's edge", () => {
    const out = layoutTiles(SET, FULL_BASE, FULL_VIEW, 2);
    expect(out.level).toBe(2);
    expect(out.tiles).toHaveLength(48);
    const at = (c: number, r: number) =>
      out.tiles.find((t) => t.col === c && t.row === r)!;
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 7; c++) {
        expect(at(c, r).x + at(c, r).w).toBe(at(c + 1, r).x);
      }
    }
    for (let c = 0; c < 8; c++) {
      for (let r = 0; r < 5; r++) {
        expect(at(c, r).y + at(c, r).h).toBe(at(c, r + 1).y);
      }
    }
    expect(Math.max(...out.tiles.map((t) => t.x + t.w))).toBe(1102);
    expect(Math.max(...out.tiles.map((t) => t.y + t.h))).toBe(826.5);
  });

  test("an empty view mounts nothing beyond the clamped margin range", () => {
    const out = layoutTiles(SET, FULL_BASE, FULL_VIEW, 2);
    expect(out.tiles.every((t) => t.key === `2/${t.col}_${t.row}`)).toBe(true);
  });
});

describe("layoutTilesAtLevel", () => {
  test("at the level layoutTiles picks it gives the same tiles", () => {
    const auto = layoutTiles(SET, FULL_BASE, FULL_VIEW, 2);
    expect(layoutTilesAtLevel(SET, 2, FULL_BASE, FULL_VIEW, 2)).toEqual(
      auto.tiles,
    );
  });

  test("at another level it lays that level out over the current base", () => {
    const tiles = layoutTilesAtLevel(SET, 3, FULL_BASE, FULL_VIEW, 2);
    expect(tiles).toHaveLength(12);
    expect(tiles.every((t) => t.key.startsWith("3/"))).toBe(true);
    expect(Math.max(...tiles.map((t) => t.x + t.w))).toBe(1102);
  });
});
