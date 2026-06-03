// §4.2 / §5.5 — zoom-aware positioning for the table ⊕ insert button.
//
// The button is a 20×20 `position: fixed` circle inside the CSS-zoom container,
// which WKWebView renders at (zoom × top, zoom × left). computeInsertButtonStyle
// divides the visual edge coordinate by zoom so that render-time scaling cancels
// and the button's visual center lands on the edge point. These tests encode the
// full round-trip: rendered_visual = zoom × set, visual_center = rendered + 10×zoom.
import { describe, expect, it } from "vitest";

import { computeInsertButtonStyle } from "../../components/toolbar/table-insert-coords";

const HALF = 10; // half the 20px button
const GUTTER = 12; // nudge into the margin off the table edge

/** Where the 20px button's visual center renders, given the CSS offset + zoom. */
function visualCenter(set: number, zoom: number): number {
  // rendered visual top-left = zoom × set; visual size = zoom × 20; center += 10×zoom
  return zoom * set + HALF * zoom;
}

describe("computeInsertButtonStyle", () => {
  it("is a no-op transform at zoom 1.0", () => {
    expect(
      computeInsertButtonStyle({ type: "col", x: 200, y: 100 }, 1),
    ).toEqual({
      left: 200 - HALF, // centered on the column boundary
      top: 100 - (HALF + GUTTER), // lifted into the gutter above the table
    });
    expect(
      computeInsertButtonStyle({ type: "row", x: 200, y: 100 }, 1),
    ).toEqual({
      left: 200 - (HALF + GUTTER), // lifted into the left gutter
      top: 100 - HALF, // centered on the row boundary
    });
  });

  it("centers a column button's visual center on the boundary at zoom 2", () => {
    const edgeX = 400;
    const { left } = computeInsertButtonStyle(
      { type: "col", x: edgeX, y: 300 },
      2,
    );
    expect(left).toBe(190); // 400/2 - 10
    // render-time scaling cancels → visual center sits exactly on the edge
    expect(visualCenter(left, 2)).toBe(edgeX);
  });

  it("centers a row button's visual center on the boundary at zoom 2", () => {
    const edgeY = 300;
    const { top } = computeInsertButtonStyle(
      { type: "row", x: 500, y: edgeY },
      2,
    );
    expect(top).toBe(140); // 300/2 - 10
    expect(visualCenter(top, 2)).toBe(edgeY);
  });

  it("keeps the gutter nudge proportional to zoom (12 content-px)", () => {
    const edgeY = 300;
    const zoom = 2;
    const { top } = computeInsertButtonStyle(
      { type: "col", x: 400, y: edgeY },
      zoom,
    );
    // visual center is GUTTER content-px above the edge → GUTTER × zoom visually
    expect(visualCenter(top, zoom)).toBe(edgeY - GUTTER * zoom);
  });

  it("handles fractional zoom (1.5) without residual offset", () => {
    const edgeX = 300;
    const { left } = computeInsertButtonStyle(
      { type: "col", x: edgeX, y: 200 },
      1.5,
    );
    expect(visualCenter(left, 1.5)).toBeCloseTo(edgeX, 6);
  });
});
