// §298 Vim Phase 1 core — VisualState tests (design §6).

import { describe, expect, it } from "vitest";

import {
  collapseTarget,
  isReversed,
  moveVisualHead,
  startVisual,
  visualRange,
} from "../visual-state";

describe("anchor behaviour", () => {
  it("starts collapsed on the cursor", () => {
    expect(startVisual(7)).toEqual({
      anchorCursor: 7,
      headCursor: 7,
      kind: "char",
    });
  });

  it("keeps the anchor fixed through a direction inversion", () => {
    let v = startVisual(10);
    v = moveVisualHead(v, 14);
    expect(isReversed(v)).toBe(false);
    v = moveVisualHead(v, 4);
    expect(v.anchorCursor).toBe(10); // unchanged across the crossing
    expect(isReversed(v)).toBe(true);
  });
});

describe("inclusive rendering", () => {
  it("covers one unit at v-entry, never an empty range", () => {
    // Cursor on a grapheme: the adapter passes the position after it.
    const range = visualRange(startVisual(3), 4);
    expect(range).toEqual({ from: 3, to: 4 });
    expect(range.to).toBeGreaterThan(range.from);
  });

  it("extends to the unit end when moving right", () => {
    const v = moveVisualHead(startVisual(3), 8);
    expect(visualRange(v, 9)).toEqual({ from: 3, to: 9 });
  });

  it("spans head..anchor when reversed, still inclusive of the anchor unit", () => {
    const v = moveVisualHead(startVisual(8), 3);
    // Rightmost cursor is the anchor at 8; its unit ends at 9.
    expect(visualRange(v, 9)).toEqual({ from: 3, to: 9 });
  });

  it("never returns a `to` behind the rightmost cursor", () => {
    // A caller that mis-computes unitEnd must not produce an inverted range.
    const v = moveVisualHead(startVisual(2), 6);
    expect(visualRange(v, 1)).toEqual({ from: 2, to: 6 });
  });
});

describe("collapse", () => {
  it("collapses to the head, not to whichever end PM calls head", () => {
    expect(collapseTarget(moveVisualHead(startVisual(9), 2))).toBe(2);
    expect(collapseTarget(moveVisualHead(startVisual(2), 9))).toBe(9);
  });
});
