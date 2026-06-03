// §4.2 / §5.5 — zoom-aware positioning for the table ⊕ insert button.
//
// The button is a 20×20 `position: fixed` circle inside the CSS-zoom container,
// which WKWebView renders at (zoom × top, zoom × left). computeInsertButtonStyle
// divides the visual edge coordinate by zoom so that render-time scaling cancels
// and the button's visual center lands on the edge point. These tests encode the
// full round-trip: rendered_visual = zoom × set, visual_center = rendered + 10×zoom.
import { afterEach, describe, expect, it } from "vitest";

import {
  computeInsertButtonStyle,
  findTableNearPoint,
  isPointNearRect,
  type NearMargins,
} from "../../components/toolbar/table-insert-coords";

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

// §5.5 — detection geometry. A table occupying visual rect [100,200] × [50,150].
const RECT = { left: 100, right: 200, top: 50, bottom: 150 };
const NONE: NearMargins = { left: 0, right: 0, top: 0, bottom: 0 };

describe("isPointNearRect", () => {
  it("is true inside the rect, false outside (zero margins)", () => {
    expect(isPointNearRect(150, 100, RECT, NONE)).toBe(true);
    expect(isPointNearRect(90, 100, RECT, NONE)).toBe(false); // 10px left
    expect(isPointNearRect(150, 40, RECT, NONE)).toBe(false); // 10px above
  });

  it("expands each side independently by its own margin", () => {
    // 10px left of the edge becomes inside only with a left margin
    expect(isPointNearRect(92, 100, RECT, { ...NONE, left: 10 })).toBe(true);
    expect(isPointNearRect(92, 100, RECT, { ...NONE, right: 10 })).toBe(false);
    // a left margin does NOT leak to the right side
    expect(isPointNearRect(208, 100, RECT, { ...NONE, left: 10 })).toBe(false);
    expect(isPointNearRect(208, 100, RECT, { ...NONE, right: 10 })).toBe(true);
    // top / bottom
    expect(isPointNearRect(150, 42, RECT, { ...NONE, top: 10 })).toBe(true);
    expect(isPointNearRect(150, 158, RECT, { ...NONE, bottom: 10 })).toBe(true);
  });

  it("includes the exact expanded edge (boundary is inclusive)", () => {
    // a point exactly 32px above the top with a 32px top margin still counts —
    // this is the gap that the old 20px probe could not reach
    expect(isPointNearRect(150, 50 - 32, RECT, { ...NONE, top: 32 })).toBe(
      true,
    );
  });
});

describe("findTableNearPoint", () => {
  function mountTables(rects: (typeof RECT)[]): void {
    const scroll = document.createElement("div");
    scroll.className = "editor-area-scroll";
    for (const r of rects) {
      const t = document.createElement("table");
      t.getBoundingClientRect = () =>
        ({
          ...r,
          width: r.right - r.left,
          height: r.bottom - r.top,
          x: r.left,
          y: r.top,
          toJSON: () => ({}),
        }) as DOMRect;
      scroll.appendChild(t);
    }
    document.body.appendChild(scroll);
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("returns null when no .editor-area-scroll exists", () => {
    expect(findTableNearPoint(150, 100, NONE)).toBeNull();
  });

  it("returns null when the point is beyond every table's margin", () => {
    mountTables([RECT]);
    expect(
      findTableNearPoint(500, 500, { ...NONE, left: 5, top: 5 }),
    ).toBeNull();
  });

  it("finds a table when the point is within the expanded margin", () => {
    mountTables([RECT]);
    const t = findTableNearPoint(95, 100, {
      left: 10,
      right: 10,
      top: 10,
      bottom: 10,
    });
    expect(t?.tagName).toBe("TABLE");
  });

  it("returns the first matching table in document order", () => {
    mountTables([RECT, { left: 100, right: 200, top: 50, bottom: 150 }]);
    const t = findTableNearPoint(150, 100, NONE);
    expect(t).toBe(document.querySelectorAll("table")[0]);
  });
});
