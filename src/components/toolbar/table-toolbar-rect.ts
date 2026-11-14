// §5.5 — Shared signal: the floating table toolbar's current visual-viewport
// rect, so hover affordances (TableInsertButtons ⊕, TableSelectionHandles grip)
// can suppress themselves where they'd render under the toolbar (footprint-only
// deconfliction). Read synchronously from mousemove handlers — no React state,
// so no re-render churn on the hover hot path.
import { isPointNearRect } from "./table-insert-coords";

let toolbarRect: DOMRect | null = null;

/** Current toolbar rect, or null when the toolbar is hidden. */
export function getTableToolbarRect(): DOMRect | null {
  return toolbarRect;
}

/**
 * True when (x, y) falls within the toolbar's horizontal footprint AND is
 * vertically adjacent to it (within `margin` px above/below). Used to hide a
 * top-edge ⊕/grip candidate that would collide with the toolbar. A null rect
 * (toolbar hidden) always returns false, so affordances show normally.
 *
 * All arguments are visual px. `margin` is how far the candidate reaches past
 * the table edge — its reach in CSS px (INSERT_BUTTON_REACH, HANDLE_REACH)
 * × the editor zoom, since the zoom scales it like the table. A toolbar in its
 * usual place sits TOOLBAR_GAP above the table, more than either reach, so it
 * hides nothing; this matters when the toolbar is pinned to the top of the
 * editor area just above a table's top.
 */
export function isUnderToolbar(
  x: number,
  y: number,
  rect: DOMRect | null,
  margin: number,
): boolean {
  if (!rect) return false;
  return isPointNearRect(x, y, rect, {
    left: 0,
    right: 0,
    top: margin,
    bottom: margin,
  });
}

/** Publish the toolbar's rect (visual-viewport space) or null when hidden. */
export function setTableToolbarRect(rect: DOMRect | null): void {
  toolbarRect = rect;
}
