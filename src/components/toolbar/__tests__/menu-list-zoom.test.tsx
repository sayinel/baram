// §4.2 / §4.8 — MenuList opens where it was asked to under the editor zoom.
//
// The menu is `position: fixed`. Drawn inside `.editor-area-scroll`, whose CSS
// zoom draws a fixed box at zoom × its `left`/`top` (zoom-coords.ts, rule 2),
// a menu given a click's clientX/Y as its `left`/`top` opened at zoom × that
// point — twice as far from the window corner at 200 %. MenuList measures the
// zoom it is drawn at (visual width over CSS width) and divides.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MenuList } from "../MenuList";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** jsdom has no layout: the menu reports `cssWidth` CSS px drawn at `zoom`. */
function drawnAt(zoom: number, cssWidth = 160, cssHeight = 100) {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains("context-menu") ? cssWidth : 0;
    },
  );
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const w = this.classList.contains("context-menu") ? cssWidth * zoom : 0;
      const h = this.classList.contains("context-menu") ? cssHeight * zoom : 0;
      return {
        bottom: h,
        height: h,
        left: 0,
        right: w,
        top: 0,
        width: w,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    },
  );
}

function menuStyle(): CSSStyleDeclaration {
  const menu = document.querySelector<HTMLElement>(".context-menu");
  if (!menu) throw new Error("menu did not render");
  return menu.style;
}

const items = [{ action: () => {}, label: "One" }];

describe("MenuList under the editor zoom", () => {
  it("places itself at the visual point at zoom 1", () => {
    drawnAt(1);
    render(<MenuList items={items} onClose={() => {}} x={200} y={100} />);
    expect(menuStyle().left).toBe("200px");
    expect(menuStyle().top).toBe("100px");
  });

  it("divides the visual point by the zoom it is drawn at", () => {
    drawnAt(2);
    render(<MenuList items={items} onClose={() => {}} x={200} y={100} />);
    expect(menuStyle().left).toBe("100px");
    expect(menuStyle().top).toBe("50px");
  });

  it("clamps to the window in visual px before dividing", () => {
    // 320 px wide on screen at x 900 would pass the 1024 px window: it moves
    // to 1024 - 320 - 4 = 700 visual, which is 350 CSS px at zoom 2.
    drawnAt(2);
    render(<MenuList items={items} onClose={() => {}} x={900} y={100} />);
    expect(window.innerWidth).toBe(1024);
    expect(menuStyle().left).toBe("350px");
  });
});
