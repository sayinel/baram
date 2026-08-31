// Floating menus must not steal the caret on mousedown.
//
// These popups are appended to document.body, so pressing the mouse on an
// entry blurs the editor and drops the selection — while choosing the same
// entry with the arrow keys never leaves the editor at all. Users report that
// asymmetry as "the cursor disappears when I click, but not with the keyboard".
import { describe, expect, it, vi } from "vitest";

vi.mock("@tiptap/react", () => ({
  ReactRenderer: class {
    element = document.createElement("div");
    destroy() {}
    updateProps() {}
  },
}));

import {
  createSuggestionRenderer,
  keepCaretOnMouseDown,
  positionPopup,
  trackPopupPosition,
} from "../suggestion-renderer";

/** Press the mouse on an element and report whether the default was cancelled. */
function mousedownCancelled(el: HTMLElement): boolean {
  const event = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
  });
  el.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("keepCaretOnMouseDown", () => {
  it("cancels mousedown so the editor keeps focus", () => {
    const popup = document.createElement("div");
    keepCaretOnMouseDown(popup);

    expect(mousedownCancelled(popup)).toBe(true);
  });

  it("cancels it for a child too, since entries are what get clicked", () => {
    // The listener sits on the container and relies on bubbling — an entry
    // deep inside the menu is the thing a user actually presses.
    const popup = document.createElement("div");
    keepCaretOnMouseDown(popup);
    const entry = document.createElement("button");
    popup.append(entry);

    expect(mousedownCancelled(entry)).toBe(true);
  });

  it("leaves click alone, which is what selects the entry", () => {
    // ‼️ Cancelling click as well would keep the caret and select nothing.
    const popup = document.createElement("div");
    keepCaretOnMouseDown(popup);

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    popup.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(false);
  });
});

describe("the shared suggestion renderer applies it", () => {
  it("guards the popup it appends to the body", () => {
    const render = createSuggestionRenderer({
      component: (() => null) as never,
      menuHeight: 300,
      popupClass: "focus-test-popup",
    });
    const handlers = render();

    (handlers.onStart as (p: unknown) => void)({
      clientRect: () => null,
      command: () => {},
      editor: {},
      items: [],
      range: { from: 0, to: 0 },
    });

    const popup = document.body.querySelector(
      ".focus-test-popup",
    ) as HTMLElement;
    expect(popup).not.toBeNull();
    expect(mousedownCancelled(popup)).toBe(true);

    popup.remove();
  });
});

// ‼️ The caret's x was used as the popup's left edge directly, so typing `@`
// near the right edge of the window put a 280px menu past it and the entries
// were cut off — and a caret at the END of a line is exactly where that
// happens. The same for a caret near the top, where `top - menuHeight` goes
// negative and the first entries land off-screen.
describe("positionPopup keeps the menu inside the viewport", () => {
  const WIDTH = 280;
  const MARGIN = 8;

  function rect(over: Partial<DOMRect>): DOMRect {
    return { bottom: 100, left: 0, top: 80, ...over } as DOMRect;
  }

  function place(coords: DOMRect, menuHeight = 300): HTMLDivElement {
    const popup = document.createElement("div");
    positionPopup(popup, coords, menuHeight);
    return popup;
  }

  it("pulls the menu back when the caret is near the right edge", () => {
    const popup = place(rect({ left: window.innerWidth - 20 }));

    const left = Number.parseInt(popup.style.left, 10);
    expect(left + WIDTH).toBeLessThanOrEqual(window.innerWidth);
  });

  it("leaves the menu at the caret when there is room", () => {
    const popup = place(rect({ left: 40 }));

    expect(popup.style.left).toBe("40px");
  });

  it("never pushes the menu off the left edge", () => {
    // A narrow window, where even the clamped position would go negative.
    const popup = place(rect({ left: 4 }));

    expect(Number.parseInt(popup.style.left, 10)).toBeGreaterThanOrEqual(
      MARGIN,
    );
  });

  it("keeps the menu on screen when it has to open upward", () => {
    // No room below and a caret near the top: the old maths produced a
    // negative top and clipped the entries the user most wants to see.
    const popup = place(
      rect({ bottom: window.innerHeight - 10, top: 20 }),
      300,
    );

    expect(Number.parseInt(popup.style.top, 10)).toBeGreaterThanOrEqual(MARGIN);
  });

  it("opens below the caret when there is room", () => {
    const popup = place(rect({ bottom: 100, top: 80 }), 50);

    expect(popup.style.top).toBe("104px");
  });
});

// ‼️ These menus render through a React portal, which commits on a LATER tick
// than the onStart that creates the popup. Measuring during onStart measures an
// EMPTY box, so the clamp concluded a 280px menu fitted where only ~109px did —
// and nothing recomputed the position once the real menu arrived. That is why
// clamping the left edge and pinning the popup width both failed on their own:
// the arithmetic was right, the width it ran on was not.
describe("trackPopupPosition re-places the popup when its size arrives", () => {
  const observed: (() => void)[] = [];

  class FakeResizeObserver {
    constructor(private cb: () => void) {}
    disconnect() {
      const i = observed.indexOf(this.cb);
      if (i >= 0) observed.splice(i, 1);
    }
    observe() {
      observed.push(this.cb);
    }
  }

  function withObserver<T>(run: () => T): T {
    const original = (globalThis as { ResizeObserver?: unknown })
      .ResizeObserver;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
      FakeResizeObserver;
    try {
      return run();
    } finally {
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver = original;
    }
  }

  function caretRect(left: number): DOMRect {
    return { bottom: 100, left, top: 80 } as DOMRect;
  }

  it("repositions when the menu's real size lands after onStart", () => {
    withObserver(() => {
      const popup = document.createElement("div");
      const tracker = trackPopupPosition(popup, 300);
      // Caret near the right edge: with the empty-box fallback the clamp
      // already pulls it back, and it must STAY pulled back afterwards.
      tracker.update(caretRect(window.innerWidth - 20));
      const afterStart = popup.style.left;

      // The portal commits; the observer fires.
      observed.forEach((cb) => cb());

      expect(popup.style.left).toBe(afterStart);
      expect(Number.parseInt(popup.style.left, 10) + 280).toBeLessThanOrEqual(
        window.innerWidth,
      );
      tracker.stop();
    });
  });

  it("does nothing before it has been given a caret position", () => {
    withObserver(() => {
      const popup = document.createElement("div");
      const tracker = trackPopupPosition(popup, 300);

      observed.forEach((cb) => cb());

      expect(popup.style.left).toBe("");
      tracker.stop();
    });
  });

  it("stops observing when the menu closes", () => {
    withObserver(() => {
      const popup = document.createElement("div");
      const tracker = trackPopupPosition(popup, 300);
      tracker.update(caretRect(40));
      expect(observed).toHaveLength(1);

      tracker.stop();

      expect(observed).toHaveLength(0);
    });
  });

  it("works where ResizeObserver does not exist", () => {
    // jsdom has none; a missing one must degrade to "position once", not throw.
    const popup = document.createElement("div");
    const tracker = trackPopupPosition(popup, 300);

    expect(() => tracker.update(caretRect(40))).not.toThrow();
    expect(popup.style.left).toBe("40px");
    tracker.stop();
  });
});
