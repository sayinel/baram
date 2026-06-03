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
