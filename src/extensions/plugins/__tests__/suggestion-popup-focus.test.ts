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
