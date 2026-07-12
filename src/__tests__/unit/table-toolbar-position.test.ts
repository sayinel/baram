// §5.5 / §4.2 — floating table toolbar viewport clamp math.
import { describe, expect, it } from "vitest";

import {
  computeToolbarTop,
  type ToolbarRects,
} from "../../components/toolbar/table-toolbar-position";

// scroll viewport spans y ∈ [100, 700] (top=100, height=600). toolbar is 32 tall.
const base: Omit<ToolbarRects, "tableBottom" | "tableTop"> = {
  scrollTop: 100,
  scrollHeight: 600,
  toolbarHeight: 32,
};

describe("computeToolbarTop", () => {
  it("sits above the table when the table top is visible", () => {
    // table top at viewport-relative 200 → desired = 200 - 32 - 20 = 148
    const r: ToolbarRects = { ...base, tableTop: 300, tableBottom: 500 };
    expect(computeToolbarTop(r)).toEqual({ visible: true, top: 148 });
  });

  it("clamps to MIN_TOP when the table top scrolls above the viewport", () => {
    // table top above viewport top (negative relative), bottom still visible
    const r: ToolbarRects = { ...base, tableTop: 40, tableBottom: 400 };
    expect(computeToolbarTop(r)).toEqual({ visible: true, top: 4 });
  });

  it("hides when the table has scrolled (almost) entirely above the viewport", () => {
    // bottom-relative = 130 - 100 = 30 <= toolbarHeight(32)+MIN_TOP(4)=36 → hide
    const r: ToolbarRects = { ...base, tableTop: 10, tableBottom: 130 };
    expect(computeToolbarTop(r)).toEqual({ visible: false, top: 0 });
  });

  it("hides when the table is entirely below the viewport", () => {
    // top-relative = 800 - 100 = 700 >= scrollHeight(600) → hide
    const r: ToolbarRects = { ...base, tableTop: 800, tableBottom: 900 };
    expect(computeToolbarTop(r)).toEqual({ visible: false, top: 0 });
  });
});
