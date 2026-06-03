/**
 * §4.2 Zoom coordinate helper.
 *
 * `.editor-area-scroll` applies `zoom: var(--editor-zoom)`. Measured WKWebView
 * behavior under CSS `zoom` on an ancestor (verified empirically in PR #106):
 *
 *  1. `getBoundingClientRect()` on zoomed descendants returns **scaled visual**
 *     viewport coordinates (a 50px child reports 50 × zoom).
 *  2. A `position: fixed` descendant of the zoom container renders at
 *     `(zoom × top, zoom × left)` — scaled from the viewport origin.
 *  3. Mouse events (`clientX/Y`) and `posAtCoords()` inputs are visual
 *     viewport coordinates.
 *
 * Consequences for overlays (BlockHandle, TableInsertButtons):
 *  - Detection: mouse coords and rects already share visual space, so compare
 *    them directly. Bands / probe offsets that represent content-space sizes
 *    must be **× zoom**.
 *  - Positioning a fixed overlay on a visual point `V`: set `V / zoom` so the
 *    render-time `zoom ×` scaling cancels. All transforms are no-ops at zoom 1.
 *
 * NOTE: the former `viewportToContentCoords` helper assumed getBoundingClientRect
 * returned content-space coords (the opposite of #1) and was removed — it left a
 * `scrollLeft × (zoom − 1)` residual offset. Use the model above instead.
 */

/** Read the current editor zoom level from the CSS custom property. */
export function getEditorZoom(): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--editor-zoom")
    .trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
