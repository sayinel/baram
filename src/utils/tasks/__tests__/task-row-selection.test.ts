// §312 — the right-click selection guard, tested where its rule lives.
//
// Deliberately NOT through the panel. Opening the menu focuses the menu
// container, and jsdom collapses the document selection on focus — which makes
// every selection look cleared afterwards, whether the guard ran or not. A test
// written that way passes with the guard deleted; the interesting half (leaving
// a selection OUTSIDE the row alone) cannot be seen through it at all.
import { afterEach, describe, expect, it } from "vitest";

import { dropSelectionInside } from "../task-row-selection";

function select(el: Node): Selection {
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("dropSelectionInside", () => {
  it("clears a selection that landed inside the row", () => {
    document.body.innerHTML = `<li class="task-row"><button>5th task</button></li>`;
    const row = document.querySelector(".task-row") as HTMLElement;
    const selection = select(row.querySelector("button")!);
    expect(selection.isCollapsed).toBe(false);

    dropSelectionInside(row);

    expect(window.getSelection()?.isCollapsed).toBe(true);
  });

  // ‼️ The guard has to be closed to the row. An unconditional
  // `removeAllRanges()` would take the selection the user is holding in the
  // EDITOR — and that one is a ProseMirror selection, so the caret goes with
  // it. Right-clicking an agenda row would cost them their place.
  it("leaves a selection outside the row alone", () => {
    document.body.innerHTML = `<li class="task-row"><button>5th task</button></li><p>elsewhere</p>`;
    const row = document.querySelector(".task-row") as HTMLElement;
    select(document.querySelector("p")!);

    dropSelectionInside(row);

    expect(window.getSelection()?.isCollapsed).toBe(false);
  });

  it("does nothing when there is no selection to clear", () => {
    document.body.innerHTML = `<li class="task-row"><button>5th task</button></li>`;
    const row = document.querySelector(".task-row") as HTMLElement;

    expect(() => dropSelectionInside(row)).not.toThrow();
  });
});
