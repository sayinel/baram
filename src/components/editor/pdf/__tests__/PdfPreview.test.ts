// §272 Fix round 1 — I1: registerPageEl must receive the wrapper's rendered
// CHILD (the real .pdf-page box), not the display:contents wrapper itself
// (which has no layout box, so getBoundingClientRect()/scrollIntoView() on
// it are always inert). jsdom returns zero rects for every element
// regardless of `display`, so the layout bug itself can't be observed here
// — this pins the DOM-tree-structure half of the fix instead.
import { describe, expect, it } from "vitest";

import { resolvePageBoxEl } from "../PdfPreview";

describe("resolvePageBoxEl", () => {
  it("returns the wrapper's rendered child, not the (boxless) wrapper itself", () => {
    const wrapper = document.createElement("div");
    const pageBox = document.createElement("div");
    pageBox.className = "pdf-page";
    wrapper.append(pageBox);

    const resolved = resolvePageBoxEl(wrapper);

    expect(resolved).toBe(pageBox);
    expect(resolved).not.toBe(wrapper);
  });

  it("returns null when the wrapper has no rendered child yet", () => {
    expect(resolvePageBoxEl(document.createElement("div"))).toBeNull();
  });

  it("returns null when the wrapper itself is null (ref cleanup on unmount)", () => {
    expect(resolvePageBoxEl(null)).toBeNull();
  });
});
