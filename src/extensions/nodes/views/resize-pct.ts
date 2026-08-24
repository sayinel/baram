// §276.6 Shared width policy for the two edge-drag geometries: the centred
// media block (use-media-resize.ts) and the left-anchored inline block
// reference (use-inline-resize.ts). Only the cursor→width maths differ between
// them; the clamp and the snap have to feel identical, so they live here once.

/**
 * Clamp a raw width percentage to 10–100 and snap it to the nearest 10% when
 * it lands within ±3%, as an integer.
 *
 * ‼️ The rounding happens BEFORE the clamp and the snap on purpose: floating
 * point can otherwise put a boundary value like 57% at distance 3.0000…1 from
 * 60 and silently drop it out of the snap window. This order is what
 * computeResizePct has shipped with for images, SVG and Mermaid — changing it
 * changes them.
 */
export function clampSnapPct(rawPct: number): number {
  let pct = Math.round(rawPct);
  pct = Math.max(10, Math.min(100, pct));
  const nearest = Math.round(pct / 10) * 10;
  if (Math.abs(pct - nearest) <= 3) pct = nearest;
  return pct;
}
