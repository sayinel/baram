// §298 Vim Phase 1 — z-family view scrolling (device R7).
//
// zz / z. bring the cursor's line to the vertical center of the nearest
// scrollable ancestor. Pure view work — no transaction, no state.

import type { EditorView } from "@tiptap/pm/view";

/** The measurement surface the scroll needs — narrow for testability. */
type MeasurableView = Pick<EditorView, "coordsAtPos" | "dom">;

/** Scrolls so the cursor line sits at the CENTER of its scroll container.
 *  Layout-less environments (jsdom) and views without a scrollable
 *  ancestor no-op safely. */
export function scrollCursorToCenter(view: MeasurableView, pos: number): void {
  let top: number;
  try {
    top = view.coordsAtPos(pos).top;
  } catch {
    return; // no layout — nothing to measure
  }
  const parent = scrollParentOf(view.dom);
  if (!parent) return;
  const rect = parent.getBoundingClientRect();
  parent.scrollTop += top - (rect.top + rect.height / 2);
}

/** The nearest ancestor that actually scrolls vertically. */
export function scrollParentOf(dom: HTMLElement): HTMLElement | null {
  for (let el = dom.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (
      (overflowY === "auto" ||
        overflowY === "scroll" ||
        overflowY === "overlay") &&
      el.scrollHeight > el.clientHeight
    ) {
      return el;
    }
  }
  return null;
}
