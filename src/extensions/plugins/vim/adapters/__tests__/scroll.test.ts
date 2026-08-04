// §298 Vim Phase 1 — z-family scroll math (device R7).

import { afterEach, describe, expect, it, vi } from "vitest";

import { revealBlockInActiveEditor } from "../../../viewport-virtualize";
import {
  scrollCursorIntoView,
  scrollCursorToCenter,
  scrollParentOf,
} from "../scroll";

vi.mock("../../../viewport-virtualize", () => ({
  revealBlockInActiveEditor: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

function scrollableContainer(): HTMLElement {
  const container = document.createElement("div");
  container.style.overflowY = "auto";
  Object.defineProperty(container, "scrollHeight", { value: 2000 });
  Object.defineProperty(container, "clientHeight", { value: 400 });
  container.getBoundingClientRect = () =>
    ({
      bottom: 450,
      height: 400,
      left: 0,
      right: 800,
      top: 50,
      width: 800,
    }) as DOMRect;
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

  it("reveals a windowed block ONLY when the measurement fails", () => {
    // ops-R9: revealBlock is a forced-layout band rebuild — a measurable
    // (in-band) cursor must never trigger it; a zero rect must.
    const container = scrollableContainer();
    const dom = document.createElement("div");
    container.appendChild(dom);
    const visible = {
      coordsAtPos: () => ({ bottom: 720, left: 0, right: 0, top: 700 }),
      dom,
    };
    scrollCursorToCenter(visible, 42);
    expect(revealBlockInActiveEditor).not.toHaveBeenCalled();
    const hidden = {
      coordsAtPos: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
      dom,
    };
    scrollCursorToCenter(hidden, 42);
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

describe("scrollCursorIntoView — nearest-edge follow (ops-R8)", () => {
  function follower(top: number, bottom: number) {
    const container = scrollableContainer(); // rect top 50, height 400
    const dom = document.createElement("div");
    container.appendChild(dom);
    container.scrollTop = 100;
    const view = {
      coordsAtPos: () => ({ bottom, left: 60, right: 70, top }),
      dom,
      domAtPos: () => ({ node: dom, offset: 0 }),
    };
    return { container, view };
  }

  it("scrolls DOWN just enough when the cursor is below the fold", () => {
    const { container, view } = follower(600, 620);
    scrollCursorIntoView(view, 1);
    // bottom 620 vs edge 450-5 → +175 content px at zoom 1
    expect(container.scrollTop).toBe(275);
  });

  it("divides by the zoom on follow too", () => {
    const { container, view } = follower(600, 620);
    scrollCursorIntoView(view, 1, 2);
    // visual delta 620-(450-10) = 180 → 90 content px
    expect(container.scrollTop).toBe(190);
  });

  it("no-ops when the cursor is already visible", () => {
    const { container, view } = follower(200, 220);
    scrollCursorIntoView(view, 1);
    expect(container.scrollTop).toBe(100);
  });

  it("does NOT touch the virtualizer when the cursor measures fine", () => {
    // ops-R9: revealBlock rebuilds the whole window band — a forced-layout
    // path — so an in-band cursor must never trigger it.
    const { view } = follower(200, 220);
    scrollCursorIntoView(view, 7);
    expect(revealBlockInActiveEditor).not.toHaveBeenCalled();
  });

  it("corrects a NESTED horizontal scrollport that owns the cursor", () => {
    // ops-R9: a wide table scrolls inside a descendant wrapper — never an
    // ancestor of view.dom. The walk starts at the cursor's own node.
    const container = scrollableContainer();
    const editorDom = document.createElement("div");
    const wrapper = document.createElement("div");
    wrapper.style.overflowX = "auto";
    Object.defineProperty(wrapper, "scrollWidth", { value: 1200 });
    Object.defineProperty(wrapper, "clientWidth", { value: 300 });
    wrapper.getBoundingClientRect = () =>
      ({
        bottom: 300,
        height: 200,
        left: 0,
        right: 300,
        top: 100,
        width: 300,
      }) as DOMRect;
    const cell = document.createElement("td");
    wrapper.appendChild(cell);
    editorDom.appendChild(wrapper);
    container.appendChild(editorDom);
    const view = {
      coordsAtPos: () => ({ bottom: 220, left: 500, right: 510, top: 200 }),
      dom: editorDom,
      domAtPos: () => ({ node: cell, offset: 0 }),
    };
    scrollCursorIntoView(view, 1);
    // right 510 vs wrapper edge 300-5 → +215 on the WRAPPER
    expect(wrapper.scrollLeft).toBe(215);
    expect(container.scrollLeft).toBe(0); // outer container untouched
    expect(container.scrollTop).toBe(0); // vertically already visible
  });

  it("rejects a hidden zero rect and reveals before measuring", () => {
    const { container, view } = follower(0, 0);
    scrollCursorIntoView(view, 42);
    expect(container.scrollTop).toBe(100); // unchanged
    expect(revealBlockInActiveEditor).toHaveBeenCalledWith(42);
  });
});
