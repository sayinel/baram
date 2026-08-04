// §298 Vim Phase 1 — z-family scroll math (device R7).

import { afterEach, describe, expect, it, vi } from "vitest";

import { revealBlockInActiveEditor } from "../../../viewport-virtualize";
import { scrollCursorToCenter, scrollParentOf } from "../scroll";

vi.mock("../../../viewport-virtualize", () => ({
  revealBlockInActiveEditor: vi.fn(),
}));

afterEach(() => {
  document.body.innerHTML = "";
});

function scrollableContainer(): HTMLElement {
  const container = document.createElement("div");
  container.style.overflowY = "auto";
  Object.defineProperty(container, "scrollHeight", { value: 2000 });
  Object.defineProperty(container, "clientHeight", { value: 400 });
  container.getBoundingClientRect = () => ({ height: 400, top: 50 }) as DOMRect;
  document.body.appendChild(container);
  return container;
}

describe("scrollParentOf", () => {
  it("finds the nearest scrollable ancestor, skipping static wrappers", () => {
    const container = scrollableContainer();
    const wrapper = document.createElement("div");
    const dom = document.createElement("div");
    wrapper.appendChild(dom);
    container.appendChild(wrapper);
    expect(scrollParentOf(dom)).toBe(container);
  });

  it("is null when nothing scrolls", () => {
    const dom = document.createElement("div");
    document.body.appendChild(dom);
    expect(scrollParentOf(dom)).toBeNull();
  });
});

describe("scrollCursorToCenter", () => {
  it("moves the cursor line to the container's vertical center", () => {
    const container = scrollableContainer();
    const dom = document.createElement("div");
    container.appendChild(dom);
    container.scrollTop = 100;
    const view = {
      coordsAtPos: () => ({ bottom: 720, left: 0, right: 0, top: 700 }),
      dom,
    };
    scrollCursorToCenter(view, 1);
    // 700 - (50 + 400/2) = 450 further down
    expect(container.scrollTop).toBe(550);
  });

  it("divides the visual delta by the editor zoom (device-R7 review)", () => {
    // coordsAtPos and rects are SCALED visual coords under CSS zoom while
    // scrollTop is content-space (src/utils/zoom-coords.ts, PR 106): the
    // same 450px visual correction is 225 content pixels at zoom 2.
    const container = scrollableContainer();
    const dom = document.createElement("div");
    container.appendChild(dom);
    container.scrollTop = 100;
    const view = {
      coordsAtPos: () => ({ bottom: 720, left: 0, right: 0, top: 700 }),
      dom,
    };
    scrollCursorToCenter(view, 1, 2);
    expect(container.scrollTop).toBe(325);
  });

  it("rejects a hidden block's zero rect instead of scrolling to a lie", () => {
    const container = scrollableContainer();
    const dom = document.createElement("div");
    container.appendChild(dom);
    container.scrollTop = 100;
    const view = {
      coordsAtPos: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
      dom,
    };
    scrollCursorToCenter(view, 1);
    expect(container.scrollTop).toBe(100); // unchanged
  });

  it("reveals the (possibly windowed) block before measuring", () => {
    const container = scrollableContainer();
    const dom = document.createElement("div");
    container.appendChild(dom);
    const view = {
      coordsAtPos: () => ({ bottom: 720, left: 0, right: 0, top: 700 }),
      dom,
    };
    scrollCursorToCenter(view, 42);
    expect(revealBlockInActiveEditor).toHaveBeenCalledWith(42);
  });

  it("no-ops without layout or a scrollable ancestor", () => {
    const dom = document.createElement("div");
    document.body.appendChild(dom);
    const throwing = {
      coordsAtPos: () => {
        throw new Error("no layout");
      },
      dom,
    };
    expect(() => scrollCursorToCenter(throwing, 1)).not.toThrow();
    const measurable = {
      coordsAtPos: () => ({ bottom: 20, left: 0, right: 0, top: 0 }),
      dom,
    };
    expect(() => scrollCursorToCenter(measurable, 1)).not.toThrow();
  });
});
