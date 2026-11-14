// §5.5 / §4.2 — floating table toolbar viewport clamp math.
import { describe, expect, it } from "vitest";

import { INSERT_BUTTON_REACH } from "../../components/toolbar/table-insert-coords";
import { HANDLE_REACH } from "../../components/toolbar/table-selection";
import {
  clampToolbarLeft,
  computeToolbarTop,
  shownTableCenter,
  TOOLBAR_GAP,
  type ToolbarRects,
} from "../../components/toolbar/table-toolbar-position";

// scroll viewport spans y ∈ [100, 700] (top=100, height=600). toolbar is 32 tall.
const base: Omit<ToolbarRects, "tableBottom" | "tableTop"> = {
  scrollTop: 100,
  scrollHeight: 600,
  toolbarHeight: 32,
  zoom: 1,
};

describe("computeToolbarTop", () => {
  it("sits above the table when the table top is visible", () => {
    // table top at viewport-relative 200 → desired = 200 - 32 - TOOLBAR_GAP
    const r: ToolbarRects = { ...base, tableTop: 300, tableBottom: 500 };
    expect(computeToolbarTop(r)).toEqual({
      visible: true,
      top: 200 - 32 - TOOLBAR_GAP,
    });
  });

  it("leaves the ⊕ and the grip room under a toolbar in its usual place", () => {
    // The ⊕ reaches 22 px above the table, the grip 16. A gap smaller than
    // either puts that affordance under the toolbar's bottom edge.
    const r: ToolbarRects = { ...base, tableTop: 300, tableBottom: 500 };
    const { top } = computeToolbarTop(r);
    const room = 200 - (top + base.toolbarHeight);
    expect(room).toBeGreaterThan(INSERT_BUTTON_REACH);
    expect(room).toBeGreaterThan(HANDLE_REACH);
    expect(INSERT_BUTTON_REACH).toBe(22);
    expect(HANDLE_REACH).toBe(16);
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

describe("shownTableCenter", () => {
  // scroll area left edge at x = 100; wrapper spans the text column [164, 764].
  const wrapper = {
    scrollLeft: 100,
    wrapperLeft: 164,
    wrapperRight: 764,
    zoom: 1,
  };

  it("is the table's own middle when the table is narrower than its wrapper", () => {
    // table [164, 364] → middle 264 → 164 from the scroll area's left
    expect(
      shownTableCenter({ ...wrapper, tableLeft: 164, tableRight: 364 }),
    ).toBe(164);
  });

  it("is the middle of what the wrapper shows of a wider table", () => {
    // table [64, 1064] scrolled inside the wrapper → shown [164, 764] → 464
    expect(
      shownTableCenter({ ...wrapper, tableLeft: 64, tableRight: 1064 }),
    ).toBe(364);
  });
});

describe("zoom: visual rects become the toolbar's CSS px", () => {
  it("divides the table's offset by the zoom before placing the toolbar", () => {
    // visual 400 below the scroll top at zoom 2 → 200 CSS px
    const r: ToolbarRects = {
      ...base,
      tableTop: 500,
      tableBottom: 900,
      zoom: 2,
    };
    expect(computeToolbarTop(r)).toEqual({
      visible: true,
      top: 200 - 32 - TOOLBAR_GAP,
    });
  });

  it("halves the table's middle at zoom 2", () => {
    expect(
      shownTableCenter({
        scrollLeft: 100,
        tableLeft: 164,
        tableRight: 364,
        wrapperLeft: 164,
        wrapperRight: 764,
        zoom: 2,
      }),
    ).toBe(82);
  });
});

describe("clampToolbarLeft", () => {
  it("keeps the center when the toolbar fits around it", () => {
    expect(
      clampToolbarLeft({ areaWidth: 800, center: 300, toolbarWidth: 200 }),
    ).toBe(300);
  });

  it("moves right just enough to keep the left end inside the area", () => {
    // 4 (inset) + 100 (half the toolbar)
    expect(
      clampToolbarLeft({ areaWidth: 800, center: 50, toolbarWidth: 200 }),
    ).toBe(104);
  });

  it("moves left just enough to keep the right end inside the area", () => {
    // 800 - 4 - 100
    expect(
      clampToolbarLeft({ areaWidth: 800, center: 750, toolbarWidth: 200 }),
    ).toBe(696);
  });

  it("keeps the left end in view when the area is narrower than the toolbar", () => {
    expect(
      clampToolbarLeft({ areaWidth: 150, center: 75, toolbarWidth: 200 }),
    ).toBe(104);
  });
});
