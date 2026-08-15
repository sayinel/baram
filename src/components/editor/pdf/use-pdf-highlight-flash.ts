// §275.6 Consumes the pending highlight id set by handleBlockRefNavigate
// (use-navigation.ts) once its target PDF's own sidecar has loaded and its
// pages are ready to scroll to — jumps to the highlight's page and flashes it
// briefly. Split out of use-pdf-highlights.ts (already near the file-size
// budget) rather than grown in place; PdfPreview composes the two exactly
// like it already composes usePdfFind + usePdfHighlights.
import { useEffect, useState } from "react";

import type { Sidecar } from "./pdf-highlight-sidecar";

import { useLinkStore } from "../../../stores/editor/link";

/** How long the flash affordance stays visible — matches the
 * `pdf-hl-flash` animation duration in pdf.css. */
const FLASH_DURATION_MS = 1600;

export function usePdfHighlightFlash({
  pagesReady,
  scrollToPage,
  sidecar,
}: {
  /** True once PdfPreview has a base scale and at least one page proxy — the
   * point at which every page's wrapper element is registered (PdfPreview's
   * per-page map), so `scrollToPage` can actually find its target. Reading
   * the pending id before this would silently no-op the scroll and still
   * consume the id. */
  pagesReady: boolean;
  /** The SAME function usePdfFind hands the toolbar and createLinkService —
   * see its own doc comment for why a second page registry must not exist. */
  scrollToPage: (n: number) => void;
  sidecar: null | Sidecar;
}): { flashHighlightId: null | string } {
  const pendingHighlightId = useLinkStore((s) => s.pendingPdfHighlightId);
  const [flashHighlightId, setFlashHighlightId] = useState<null | string>(null);

  useEffect(() => {
    if (!pendingHighlightId || !pagesReady || !sidecar) return;
    const hit = sidecar.highlights.find((h) => h.id === pendingHighlightId);
    // Consumed either way — leaving it set would let a later, unrelated
    // sidecar reload (e.g. after picking a color) replay a stale jump.
    useLinkStore.getState().setPendingPdfHighlightId(null);
    if (!hit) return; // deleted between the nav-time check and now — no-op
    scrollToPage(hit.page);
    setFlashHighlightId(hit.id);
  }, [pagesReady, pendingHighlightId, scrollToPage, sidecar]);

  useEffect(() => {
    if (!flashHighlightId) return;
    const timer = setTimeout(
      () => setFlashHighlightId(null),
      FLASH_DURATION_MS,
    );
    return () => clearTimeout(timer);
  }, [flashHighlightId]);

  return { flashHighlightId };
}
