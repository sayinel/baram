// Tests for §4.2 Zoom coordinate helper
import { afterEach, describe, expect, it, vi } from "vitest";

import { getEditorZoom } from "../../utils/zoom-coords";

/** Mock the `--editor-zoom` custom property value. */
function mockZoom(zoom: number): void {
  vi.spyOn(window, "getComputedStyle").mockReturnValue({
    getPropertyValue: (prop: string) =>
      prop === "--editor-zoom" ? String(zoom) : "",
  } as unknown as CSSStyleDeclaration);
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("getEditorZoom", () => {
  it("reads the --editor-zoom custom property", () => {
    mockZoom(1.5);
    expect(getEditorZoom()).toBe(1.5);
  });

  it("falls back to 1 for missing / invalid values", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: () => "",
    } as unknown as CSSStyleDeclaration);
    expect(getEditorZoom()).toBe(1);
  });

  it("falls back to 1 for a non-positive value", () => {
    mockZoom(0);
    expect(getEditorZoom()).toBe(1);
  });
});
