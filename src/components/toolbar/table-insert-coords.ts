// §4.2 / §5.5 — zoom-aware positioning math for the table ⊕ insert button.
// Kept in its own module so the React component file only exports a component
// (react-refresh/only-export-components).

/** Minimal anchor describing where the ⊕ button should sit. */
export interface InsertButtonAnchor {
  /** "col" → button above a column boundary; "row" → left of a row boundary. */
  type: "col" | "row";
  /** Visual-viewport x of the target edge (from getBoundingClientRect). */
  x: number;
  /** Visual-viewport y of the target edge (from getBoundingClientRect). */
  y: number;
}

/** Per-side margins (visual px) by which to expand a rect for hit-testing. */
export interface NearMargins {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

/** Minimal rect shape consumed by {@link isPointNearRect}. */
interface RectLike {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

/**
 * §4.2 Zoom-aware `position: fixed` offsets for the ⊕ insert button.
 *
 * The button is a 20×20 `position: fixed` circle inside the CSS-zoom container
 * (`.editor-area-scroll`). In WKWebView such a descendant renders at
 * `(zoom × top, zoom × left)` — scaled from the viewport origin (measured in
 * PR #106). `button.x`/`button.y` are visual-viewport edge coordinates (read
 * from getBoundingClientRect(), which already returns scaled visual coords), so
 * dividing by zoom cancels the render-time scaling and lands the button's visual
 * center exactly on the edge point. The 10px (half the 20px button) and 22px
 * (half + a 12px gutter nudge) offsets are content-space sizes that scale
 * together with the button, so they stay un-divided. No-op at zoom 1.
 */
export function computeInsertButtonStyle(
  button: InsertButtonAnchor,
  zoom: number,
): { left: number; top: number } {
  const isCol = button.type === "col";
  return {
    left: button.x / zoom - (isCol ? 10 : 22),
    top: button.y / zoom - (isCol ? 22 : 10),
  };
}

/**
 * Find the first editor `<table>` whose rect — expanded by `m` — contains
 * (x, y). Deterministic rect math replaces the previous directional
 * `elementFromPoint` probes, which only reached rightward/downward and so left
 * a dead band when approaching the table edge from the margin. Coordinates are
 * visual-viewport px (mouse clientX/Y and getBoundingClientRect share that space
 * under CSS zoom — see zoom-coords.ts).
 */
export function findTableNearPoint(
  x: number,
  y: number,
  m: NearMargins,
): HTMLTableElement | null {
  // §perf-large-file C3.4: scope to the ACTIVE editor's scroll container
  // so tables from a hidden keep-alive editor are excluded.
  const scroll =
    document.querySelector(".editor-area-scroll[data-editor-active]") ??
    document.querySelector(".editor-area-scroll");
  if (!scroll) return null;
  const tables = scroll.querySelectorAll("table");
  for (let i = 0; i < tables.length; i++) {
    const t = tables[i] as HTMLTableElement;
    if (isPointNearRect(x, y, t.getBoundingClientRect(), m)) return t;
  }
  return null;
}

/** True when (x, y) lies inside `rect` after expanding it by per-side margins. */
export function isPointNearRect(
  x: number,
  y: number,
  rect: RectLike,
  m: NearMargins,
): boolean {
  return (
    x >= rect.left - m.left &&
    x <= rect.right + m.right &&
    y >= rect.top - m.top &&
    y <= rect.bottom + m.bottom
  );
}
