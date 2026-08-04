// §298 Vim Phase 1 — z-family view scrolling (device R7).
//
// zz / z. bring the cursor's line to the vertical center of the nearest
// scrollable ancestor. Pure view work — no transaction, no state.

import type { EditorView } from "@tiptap/pm/view";

import { getEditorZoom } from "../../../../utils/zoom-coords";
import { revealBlockInActiveEditor } from "../../viewport-virtualize";

/** The measurement surface the scroll needs — narrow for testability. */
type MeasurableView = Pick<EditorView, "coordsAtPos" | "dom">;

/** Scrolls so the cursor line sits at the CENTER of its scroll container.
 *  Layout-less environments (jsdom) and views without a scrollable
 *  ancestor no-op safely (device-R7 review):
 *  - a windowed (display:none) block is revealed BEFORE measuring, and a
 *    zero rect — hidden layout reports zeros, it does not throw — aborts
 *    rather than scrolling toward a lie;
 *  - coordsAtPos and rects are SCALED visual coordinates under the editor's
 *    CSS zoom while scrollTop is content-space (src/utils/zoom-coords.ts),
 *    so the visual delta divides by the effective zoom. */
export function scrollCursorToCenter(
  view: MeasurableView,
  pos: number,
  zoom = getEditorZoom(),
): void {
  revealBlockInActiveEditor(pos);
  let coords: { bottom: number; top: number };
  try {
    coords = view.coordsAtPos(pos);
  } catch {
    return; // no layout — nothing to measure
  }
  if (coords.top === 0 && coords.bottom === 0) return; // hidden block
  const parent = scrollParentOf(view.dom);
  if (!parent) return;
  const rect = parent.getBoundingClientRect();
  parent.scrollTop += (coords.top - (rect.top + rect.height / 2)) / zoom;
}

/** Keep the cursor this far off the container edge (CONTENT pixels —
 *  PM's own scrollMargin default). */
const SCROLL_MARGIN = 5;

/**
 * Vim's cursor-follow scroll — the nearest-edge counterpart of the
 * centering above, replacing PM's default scrollIntoView while vim owns
 * the surface (ops-R8): reveals a windowed block before measuring,
 * rejects hidden zero rects, and divides visual deltas by the editor
 * zoom on BOTH axes. No-op when the cursor is already in view.
 */
export function scrollCursorIntoView(
  view: MeasurableView,
  pos: number,
  zoom = getEditorZoom(),
): void {
  revealBlockInActiveEditor(pos);
  let coords: { bottom: number; left: number; right: number; top: number };
  try {
    coords = view.coordsAtPos(pos);
  } catch {
    return; // no layout — nothing to measure
  }
  if (coords.top === 0 && coords.bottom === 0) return; // hidden block
  const parent = scrollParentOf(view.dom);
  if (!parent) return;
  const rect = parent.getBoundingClientRect();
  const margin = SCROLL_MARGIN * zoom; // compared in visual space
  if (coords.top < rect.top + margin) {
    parent.scrollTop += (coords.top - (rect.top + margin)) / zoom;
  } else if (coords.bottom > rect.bottom - margin) {
    parent.scrollTop += (coords.bottom - (rect.bottom - margin)) / zoom;
  }
  if (coords.left < rect.left + margin) {
    parent.scrollLeft += (coords.left - (rect.left + margin)) / zoom;
  } else if (coords.right > rect.right - margin) {
    parent.scrollLeft += (coords.right - (rect.right - margin)) / zoom;
  }
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
