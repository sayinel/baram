// §377 Rows and arrow keys over the symbol picker's grid.
import type { SymbolSuggestionItem } from "../../../extensions/plugins/symbol-search";
import type {
  SymbolSection,
  SymbolSectionId,
} from "../../../extensions/plugins/symbol-sections";

import { describe, expect, it } from "vitest";

import {
  clampPosition,
  type GridArrow,
  isGridArrow,
  moveInGrid,
  SYMBOL_GRID_COLUMNS,
  toGridRows,
} from "../symbol-grid-nav";

const item = (char: string): SymbolSuggestionItem => ({
  char,
  id: char,
  label: char,
});
const section = (id: SymbolSectionId, n: number): SymbolSection => ({
  id,
  items: Array.from({ length: n }, (_, i) => item(`${id}${i}`)),
});

// Four columns: arrows (10) → rows of 4, 4, 2; math (3) → one row of 3.
const rows = toGridRows([section("arrows", 10), section("math", 3)], 4);

describe("toGridRows", () => {
  it("cuts each section into rows and never lets two sections share one", () => {
    expect(rows.map((r) => [r.sectionId, r.items.length])).toEqual([
      ["arrows", 4],
      ["arrows", 4],
      ["arrows", 2],
      ["math", 3],
    ]);
  });

  it("cuts at SYMBOL_GRID_COLUMNS by default", () => {
    const lengths = toGridRows([
      section("arrows", SYMBOL_GRID_COLUMNS + 1),
    ]).map((r) => r.items.length);
    expect(lengths).toEqual([SYMBOL_GRID_COLUMNS, 1]);
  });

  it("gives an empty section no row", () => {
    expect(
      toGridRows([section("recent", 0), section("arrows", 1)]),
    ).toHaveLength(1);
  });
});

describe("moveInGrid", () => {
  it.each([
    [
      "Right within a row",
      { col: 1, row: 0 },
      "ArrowRight",
      { col: 2, row: 0 },
    ],
    [
      "Right off a row's end",
      { col: 3, row: 0 },
      "ArrowRight",
      { col: 0, row: 1 },
    ],
    [
      "Right across a section boundary",
      { col: 1, row: 2 },
      "ArrowRight",
      { col: 0, row: 3 },
    ],
    [
      "Right at the last cell stays",
      { col: 2, row: 3 },
      "ArrowRight",
      { col: 2, row: 3 },
    ],
    [
      "Left off a row's start",
      { col: 0, row: 3 },
      "ArrowLeft",
      { col: 1, row: 2 },
    ],
    [
      "Left at the first cell stays",
      { col: 0, row: 0 },
      "ArrowLeft",
      { col: 0, row: 0 },
    ],
    [
      "Down keeps the column",
      { col: 3, row: 0 },
      "ArrowDown",
      { col: 3, row: 1 },
    ],
    [
      "Down into a shorter row takes its last cell",
      { col: 3, row: 1 },
      "ArrowDown",
      { col: 1, row: 2 },
    ],
    [
      "Down at the last row stays",
      { col: 1, row: 3 },
      "ArrowDown",
      { col: 1, row: 3 },
    ],
    [
      "Up into a shorter row takes its last cell",
      { col: 2, row: 3 },
      "ArrowUp",
      { col: 1, row: 2 },
    ],
    [
      "Up at the first row stays",
      { col: 2, row: 0 },
      "ArrowUp",
      { col: 2, row: 0 },
    ],
  ])("%s", (_, from, key, to) => {
    expect(moveInGrid(rows, from, key as GridArrow)).toEqual(to);
  });
});

describe("clampPosition", () => {
  it("is null when there are no cells", () => {
    expect(clampPosition([], { col: 0, row: 0 })).toBeNull();
  });

  it("pulls a position past the end back to the nearest cell", () => {
    expect(clampPosition(rows, { col: 3, row: 9 })).toEqual({ col: 2, row: 3 });
  });

  it("leaves a cell that exists alone", () => {
    expect(clampPosition(rows, { col: 1, row: 2 })).toEqual({ col: 1, row: 2 });
  });
});

describe("isGridArrow", () => {
  it.each(["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp"])(
    "%s is one",
    (key) => {
      expect(isGridArrow(key)).toBe(true);
    },
  );

  it.each(["Enter", "Tab", "a"])("%s is not", (key) => {
    expect(isGridArrow(key)).toBe(false);
  });
});
