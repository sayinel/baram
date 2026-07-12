// §5.5 / §4.2 — pure placement math for the floating table toolbar.
// Kept in its own module so TableToolbar.tsx can be unit-tested without a DOM.
//
// All inputs are visual-viewport px (getBoundingClientRect space). The returned
// `top` is relative to the scroll container's top — which equals the toolbar's
// containing block (`.editor-area`) top, since `.editor-area-scroll` is the first
// child of `.editor-area` and their top edges coincide. Zoom handling is unchanged
// from the prior formula (correct at zoom 1).

export interface ToolbarPlacement {
  top: number;
  visible: boolean;
}

export interface ToolbarRects {
  /** .editor-area-scroll rect height */
  scrollHeight: number;
  /** .editor-area-scroll rect top */
  scrollTop: number;
  /** table.getBoundingClientRect().bottom */
  tableBottom: number;
  /** table.getBoundingClientRect().top */
  tableTop: number;
  /** measured toolbar height (offsetHeight) */
  toolbarHeight: number;
}

/**
 * Gap between the toolbar bottom and the table top when the top is visible.
 * Wide enough to clear the grip/⊕ upward protrusion (~16px) so the toolbar and
 * the hover affordances never visually kiss at the table's top edge (§5.5).
 */
const GAP = 20;
/** Sticky inset from the top of the visible editor area. */
const MIN_TOP = 4;

export function computeToolbarTop(r: ToolbarRects): ToolbarPlacement {
  const tableTopRel = r.tableTop - r.scrollTop;
  const tableBottomRel = r.tableBottom - r.scrollTop;

  // Table scrolled (almost) entirely above the viewport → nothing useful to pin to.
  if (tableBottomRel <= r.toolbarHeight + MIN_TOP)
    return { visible: false, top: 0 };
  // Table entirely below the viewport (safety guard).
  if (tableTopRel >= r.scrollHeight) return { visible: false, top: 0 };

  const desired = tableTopRel - r.toolbarHeight - GAP;
  return { visible: true, top: Math.max(desired, MIN_TOP) };
}
