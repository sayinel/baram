// §5.5 — footprint-suppression geometry for the table toolbar rect signal.
import { describe, expect, it } from "vitest";

import {
  getTableToolbarRect,
  isUnderToolbar,
  setTableToolbarRect,
} from "../../components/toolbar/table-toolbar-rect";

// A toolbar occupying x ∈ [200, 400], y ∈ [100, 132] (visual-viewport px).
const rect = { left: 200, right: 400, top: 100, bottom: 132 } as DOMRect;

describe("isUnderToolbar", () => {
  it("is false when the rect is null (toolbar hidden)", () => {
    expect(isUnderToolbar(300, 132, null)).toBe(false);
  });

  it("is true for a point inside the horizontal footprint at the table edge", () => {
    // grip/⊕ sits just below the toolbar bottom (132) → within default margin 16
    expect(isUnderToolbar(300, 140, rect)).toBe(true);
  });

  it("is false for a point outside the horizontal footprint", () => {
    // same y, but x left of the toolbar → the ⊕ there must still show
    expect(isUnderToolbar(150, 140, rect)).toBe(false);
  });

  it("is false for a point vertically far from the toolbar", () => {
    // deep inside a tall table, far below the toolbar → not suppressed
    expect(isUnderToolbar(300, 400, rect)).toBe(false);
  });

  it("respects a custom margin", () => {
    expect(isUnderToolbar(300, 150, rect, 4)).toBe(false); // 150 > 132 + 4
    expect(isUnderToolbar(300, 150, rect, 32)).toBe(true); // 150 < 132 + 32
  });

  it("round-trips the stored rect via the setter/getter", () => {
    setTableToolbarRect(rect);
    expect(getTableToolbarRect()).toBe(rect);
    setTableToolbarRect(null);
    expect(getTableToolbarRect()).toBe(null);
  });
});
