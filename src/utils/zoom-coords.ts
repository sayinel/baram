/**
 * §4.2 Zoom coordinate conversion utility.
 *
 * When CSS zoom is applied to .editor-area-scroll, getBoundingClientRect()
 * on children returns content-space coordinates, but mouse event clientX/Y
 * are in viewport space. This utility converts viewport coordinates to
 * content space so comparisons with getBoundingClientRect() work correctly.
 */

/** Read the current editor zoom level from the CSS custom property. */
export function getEditorZoom(): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--editor-zoom")
    .trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Convert viewport-space mouse coordinates to the content-space of the
 * zoomed .editor-area-scroll container.
 *
 * At zoom 1.0 this is a no-op. At other zoom levels, the mouse position
 * is adjusted relative to the scroll container's origin.
 */
export function viewportToContentCoords(
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const zoom = getEditorZoom();
  if (Math.abs(zoom - 1) < 0.001) return { x: clientX, y: clientY };

  const scrollEl = document.querySelector(
    ".editor-area-scroll",
  ) as HTMLElement | null;
  if (!scrollEl) return { x: clientX, y: clientY };

  // The scroll element's own rect is in viewport space (zoom affects children,
  // not the element's own position in the parent layout).
  const sr = scrollEl.getBoundingClientRect();

  return {
    x: sr.left + (clientX - sr.left) / zoom,
    y: sr.top + (clientY - sr.top) / zoom,
  };
}
