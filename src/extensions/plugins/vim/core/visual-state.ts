// §298 Vim Phase 1 core — VisualState bookkeeping (design §6).
//
// vim's visual selection is not a ProseMirror TextSelection with extra
// meaning bolted on: the anchor is fixed at the position where `v` was
// pressed and never moves, direction inversion moves only the head, and what
// the user SEES is inclusive of the unit under the head.
//
// Positions are opaque numbers here. Resolving "the next unit boundary" needs
// the document, so the adapter supplies it — this module only decides which
// end is which.

import type { VisualState } from "./types";

/**
 * Where the cursor lands when visual mode ends. vim collapses to the HEAD —
 * the place the user navigated to — not to PM's selection head, which after
 * an inversion is the other end entirely.
 */
export function collapseTarget(visual: VisualState): number {
  return visual.headCursor;
}

/** True once the head has crossed to the left of the anchor. */
export function isReversed(visual: VisualState): boolean {
  return visual.headCursor < visual.anchorCursor;
}

/** Move the head; the anchor never moves, even across an inversion. */
export function moveVisualHead(
  visual: VisualState,
  headCursor: number,
): VisualState {
  return { anchorCursor: visual.anchorCursor, headCursor };
}

export function startVisual(cursor: number): VisualState {
  return { anchorCursor: cursor, headCursor: cursor };
}

/**
 * The half-open PM range to render, given the end of the unit under the
 * rightmost cursor. `unitEnd` is what makes the selection INCLUSIVE: with a
 * cursor sitting on "한", the adapter passes the position after that grapheme.
 *
 * At `v`-entry anchor === head, so this still yields a one-unit selection —
 * never an empty one.
 */
export function visualRange(
  visual: VisualState,
  unitEnd: number,
): { from: number; to: number } {
  const from = Math.min(visual.anchorCursor, visual.headCursor);
  const to = Math.max(
    unitEnd,
    Math.max(visual.anchorCursor, visual.headCursor),
  );
  return { from, to };
}
