// Tests for §4.2 Zoom coordinate conversion utilities
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getEditorZoom,
  viewportToContentCoords,
} from "../../utils/zoom-coords";

/** Install a fake `.editor-area-scroll` element + `--editor-zoom` value. */
function setupZoom(zoom: number, srLeft: number, srTop: number): HTMLElement {
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    getPropertyValue: (prop: string) =>
      prop === "--editor-zoom" ? String(zoom) : "",
  } as unknown as CSSStyleDeclaration);

  const el = document.createElement("div");
  el.className = "editor-area-scroll";
  el.getBoundingClientRect = () =>
    ({
      left: srLeft,
      top: srTop,
      right: srLeft,
      bottom: srTop,
      width: 0,
      height: 0,
      x: srLeft,
      y: srTop,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("getEditorZoom", () => {
  it("reads the --editor-zoom custom property", () => {
    setupZoom(1.5, 0, 0);
    expect(getEditorZoom()).toBe(1.5);
  });

  it("falls back to 1 for missing / invalid values", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: () => "",
    } as unknown as CSSStyleDeclaration);
    expect(getEditorZoom()).toBe(1);
  });
});

describe("viewportToContentCoords", () => {
  it("is an identity transform at zoom 1.0 (no-op)", () => {
    setupZoom(1, 100, 50);
    expect(viewportToContentCoords(300, 250)).toEqual({ x: 300, y: 250 });
  });

  it("maps viewport pointer into content space when zoomed in", () => {
    // zoom 2.0, scroll origin at (100, 50)
    setupZoom(2, 100, 50);
    // content = sr + (viewport - sr) / zoom
    expect(viewportToContentCoords(300, 250)).toEqual({ x: 200, y: 150 });
  });

  it("returns input unchanged when no scroll container exists", () => {
    setupZoom(2, 100, 50);
    document.body.innerHTML = ""; // remove .editor-area-scroll
    expect(viewportToContentCoords(300, 250)).toEqual({ x: 300, y: 250 });
  });
});
