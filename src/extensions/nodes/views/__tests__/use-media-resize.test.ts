import { describe, expect, it } from "vitest";

import { computeResizePct } from "../use-media-resize";

describe("computeResizePct", () => {
  const W = 1000;
  const center = 500;

  it("maps cursor distance from centre to 2× width", () => {
    // 300px right of centre → 600px wide → 60%.
    expect(computeResizePct(800, center, W)).toBe(60);
  });

  it("works the same for the left handle (distance is absolute)", () => {
    expect(computeResizePct(200, center, W)).toBe(60);
  });

  it("snaps to the nearest 10% within ±3%", () => {
    // 285px right → 57% → within ±3% of 60 → snaps to 60.
    expect(computeResizePct(785, center, W)).toBe(60);
  });

  it("leaves values outside the ±3% snap window untouched", () => {
    // 270px right → 54% → 4% from 50, outside the window → stays 54.
    expect(computeResizePct(770, center, W)).toBe(54);
  });

  it("clamps to a 10% minimum and 100% maximum", () => {
    expect(computeResizePct(center, center, W)).toBe(10); // zero distance
    expect(computeResizePct(9999, center, W)).toBe(100); // far past edge
  });

  it("falls back to 100 for a zero-width container", () => {
    expect(computeResizePct(800, center, 0)).toBe(100);
  });
});
