// §5.5 / §4.2 — pure placement math for the floating table toolbar.
// Kept in its own module so TableToolbar.tsx can be unit-tested without a DOM.
//
// Two units meet here. Rect inputs are visual-viewport px (getBoundingClientRect
// space). What these functions return — and every size they hold in CSS px:
// TOOLBAR_GAP, the insets, the toolbar's offsetWidth/offsetHeight, the scroll
// container's clientWidth — is the toolbar's own CSS px, the unit of its `top`
// and `left`. They part under the editor zoom Z: the toolbar is drawn inside
// `.editor-area-scroll` (`zoom: var(--editor-zoom)`) but placed against
// `.editor-area`, which is outside it. WebKit draws such a box Z × its `top` and
// `left` from that containing block's corner, and getBoundingClientRect reports
// Z × every size inside the zoom, so a visual offset is ÷ Z here. Measured in
// Safari 26.6.2, whose WebKit (21624.5.1.11.3) is the system framework the app's
// WKWebView loads, at Z = 0.5, 0.8, 1, 1.25 and 2 (2026-11-14).
//
// Offsets are taken from the scroll container's corner, which is
// `.editor-area`'s corner too: `.editor-area` is a column flex box with no
// padding, and the scroll container is the only child laid out in flow while the
// markdown surface shows (the other surfaces are `display: none`, the find bar is
// absolutely placed).

import { INSERT_BUTTON_REACH } from "./table-insert-coords";
import { HANDLE_REACH } from "./table-selection";

export interface TableSpan {
  /** .editor-area-scroll rect left */
  scrollLeft: number;
  /** <table> rect left */
  tableLeft: number;
  /** <table> rect right */
  tableRight: number;
  /**
   * Rect left of the table's NodeView wrapper (`div.tableWrapper`). The
   * wrapper scrolls a table wider than itself (`overflow-x: auto`), so only the
   * part of the table inside it shows.
   */
  wrapperLeft: number;
  /** Rect right of the wrapper */
  wrapperRight: number;
  /** The editor zoom (`getEditorZoom()`) */
  zoom: number;
}

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
  /** The toolbar's height in CSS px (offsetHeight) */
  toolbarHeight: number;
  /** The editor zoom (`getEditorZoom()`) */
  zoom: number;
}

export interface ToolbarSpan {
  /**
   * Width of the room the toolbar may use, in CSS px: the scroll container's
   * clientWidth, which leaves out a scroll bar that takes space.
   */
  areaWidth: number;
  /** Where the toolbar's middle should be ({@link shownTableCenter}) */
  center: number;
  /** The toolbar's width in CSS px (offsetWidth) */
  toolbarWidth: number;
}

/** Room left between the toolbar and the farthest-reaching edge affordance. */
const CLEARANCE = 4;
/**
 * Gap between the toolbar bottom and the table top when the top is visible:
 * the farther of what the ⊕ and the grip reach above the table, plus
 * CLEARANCE, so the toolbar and the hover affordances never touch at the
 * table's top edge (§5.5).
 */
export const TOOLBAR_GAP =
  Math.max(INSERT_BUTTON_REACH, HANDLE_REACH) + CLEARANCE;
/** Sticky inset from the top of the visible editor area. */
const MIN_TOP = 4;
/** Inset the toolbar keeps from the left and right edges of the editor area. */
const SIDE_INSET = 4;

/**
 * The toolbar's CSS `left`, which is its middle: `.table-toolbar` is drawn
 * `translateX(-50%)`. It is `center`, moved in just far enough that the whole
 * toolbar stays SIDE_INSET inside the editor area — a table whose middle is
 * nearer the area's edge than half the toolbar's width would otherwise put an
 * end of the toolbar outside it. When the area is narrower than the toolbar,
 * the toolbar's left end stays in view.
 */
export function clampToolbarLeft(s: ToolbarSpan): number {
  const half = s.toolbarWidth / 2;
  const max = s.areaWidth - SIDE_INSET - half;
  return Math.max(SIDE_INSET + half, Math.min(s.center, max));
}

export function computeToolbarTop(r: ToolbarRects): ToolbarPlacement {
  const tableTopRel = (r.tableTop - r.scrollTop) / r.zoom;
  const tableBottomRel = (r.tableBottom - r.scrollTop) / r.zoom;

  // Table scrolled (almost) entirely above the viewport → nothing useful to pin to.
  if (tableBottomRel <= r.toolbarHeight + MIN_TOP)
    return { visible: false, top: 0 };
  // Table entirely below the viewport (safety guard).
  if (tableTopRel >= r.scrollHeight / r.zoom) return { visible: false, top: 0 };

  const desired = tableTopRel - r.toolbarHeight - TOOLBAR_GAP;
  return { visible: true, top: Math.max(desired, MIN_TOP) };
}

/**
 * The middle of the part of the table that shows, in CSS px from the scroll
 * container's left. A table narrower than its wrapper shows whole, so this is
 * its own middle; a wider one shows only what the wrapper's scroll exposes.
 */
export function shownTableCenter(s: TableSpan): number {
  const left = Math.max(s.tableLeft, s.wrapperLeft);
  const right = Math.min(s.tableRight, s.wrapperRight);
  return ((left + right) / 2 - s.scrollLeft) / s.zoom;
}
