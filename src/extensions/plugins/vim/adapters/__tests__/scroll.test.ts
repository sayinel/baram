// §298 Vim Phase 1 — z-family scroll math (device R7).

import { afterEach, describe, expect, it } from "vitest";

import { scrollCursorToCenter, scrollParentOf } from "../scroll";

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
