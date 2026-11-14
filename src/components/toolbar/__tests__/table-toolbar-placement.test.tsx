// §5.5 — the table toolbar centers on the table, not on its NodeView wrapper.
//
// Tiptap's TableView draws a table as `div.tableWrapper > table`. The wrapper
// is a block as wide as its container (the text column, at the top level); the
// table is only as wide as its columns. `nodeDOM(tablePos)` returns the
// wrapper, and the toolbar used to take its middle from that, so a narrow table
// got its toolbar over the middle of the text column instead of its own — past
// its right edge when the table is narrower than half the column.
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TOOLBAR_GAP } from "../table-toolbar-position";
import {
  cleanupEditors,
  mountTableWithToolbar,
} from "./table-toolbar-test-helpers";

afterEach(() => {
  cleanup();
  cleanupEditors();
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty("--editor-zoom");
});

function box(left: number, top: number, width: number, height: number) {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** The scroll area spans x ∈ [0, 600]; the wrapper fills it like the text
 *  column does; the table starts at the wrapper's left, `tableWidth` wide. */
function layout(tableWidth: number, toolbarWidth: number) {
  return (el: Element): DOMRect => {
    if (el.classList.contains("editor-area-scroll")) return box(0, 0, 600, 800);
    if (el.classList.contains("table-toolbar"))
      return box(0, 0, toolbarWidth, 32);
    if (el.classList.contains("tableWrapper")) return box(0, 200, 600, 200);
    if (el.tagName === "TABLE") return box(0, 200, tableWidth, 200);
    if (el.closest(".editor-area-scroll")) return box(0, 200, 600, 200);
    return box(0, 0, 0, 0);
  };
}

/** A table that fills a wrapper spanning x ∈ [left, left + width] — the way a
 *  table inside an indented block sits nearer the area's right edge. */
function layoutAt(left: number, width: number, toolbarWidth: number) {
  return (el: Element): DOMRect => {
    if (el.classList.contains("editor-area-scroll")) return box(0, 0, 600, 800);
    if (el.classList.contains("table-toolbar"))
      return box(0, 0, toolbarWidth, 32);
    if (el.classList.contains("tableWrapper") || el.tagName === "TABLE")
      return box(left, 200, width, 200);
    if (el.closest(".editor-area-scroll")) return box(0, 200, 600, 200);
    return box(0, 0, 0, 0);
  };
}

/** jsdom has no layout: hand out the CSS px sizes placement reads. */
function sizes(toolbarWidth: number, areaWidth = 600) {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("table-toolbar") ? toolbarWidth : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("table-toolbar") ? 30 : 0;
    },
  );
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(
    function (this: Element) {
      return this.classList.contains("editor-area-scroll") ? areaWidth : 0;
    },
  );
}

function toolbarLeft(): string {
  const toolbar = document.querySelector<HTMLElement>(".table-toolbar");
  if (!toolbar) throw new Error("table toolbar did not show");
  return toolbar.style.left;
}

describe("the table toolbar's horizontal place", () => {
  it("is the middle of a table narrower than the text column", async () => {
    // Wrapper middle is 300; reading the wrapper puts the toolbar there.
    sizes(200);
    await mountTableWithToolbar(layout(300, 200));
    expect(toolbarLeft()).toBe("150px");
  });

  it("moves in from the area's edge by its own measured width", async () => {
    // Table middle 40, toolbar 236 wide: its left end would sit at -78. The
    // clamp needs the width the toolbar has once drawn — the first render
    // has none to measure — so 4 + 236 / 2 = 122 shows the measured width
    // reached the clamp. 236 is no default anyone would write.
    sizes(236);
    await mountTableWithToolbar(layout(80, 236));
    expect(toolbarLeft()).toBe("122px");
  });

  it("is the middle of the part a table wider than its wrapper shows", async () => {
    sizes(200);
    await mountTableWithToolbar(layout(900, 200));
    expect(toolbarLeft()).toBe("300px");
  });

  it("is in the toolbar's CSS px at zoom 2: visual offsets halve", async () => {
    // Visual table middle 150 → 75 CSS px; table top 200 visual → 100 CSS px,
    // minus the 30 px toolbar and the gap. WebKit then draws both × 2, back
    // over the table (table-toolbar-position.ts).
    document.documentElement.style.setProperty("--editor-zoom", "2");
    sizes(100, 300);
    await mountTableWithToolbar(layout(300, 200));
    const toolbar = document.querySelector<HTMLElement>(".table-toolbar");
    expect(toolbar?.style.left).toBe("75px");
    expect(toolbar?.style.top).toBe(`${100 - 30 - TOOLBAR_GAP}px`);
  });

  it("keeps its right end inside the room the scroll container leaves, in CSS px", async () => {
    // At zoom 2 the 600 px visual area is 300 CSS px of clientWidth. A table
    // at the area's right edge has its middle at 500 visual = 250 CSS px; a
    // 100 px toolbar may reach 300 - 4 - 50 = 246. Read the rect width (600)
    // as the room instead and the toolbar stays at 250, over the edge.
    document.documentElement.style.setProperty("--editor-zoom", "2");
    sizes(100, 300);
    await mountTableWithToolbar(layoutAt(400, 200, 200));
    expect(toolbarLeft()).toBe("246px");
  });
});
