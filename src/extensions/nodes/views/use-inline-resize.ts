// §276.6 Edge-drag resize for an element that sits INLINE in a paragraph — the
// area-highlight block reference. Deliberately separate from useMediaResize:
// that hook is for a centred block and derives the width from twice the
// cursor's distance to the centre, which for a left-anchored element would
// double it. The clamp/snap policy is shared (resize-pct.ts) so both handles
// feel the same.
import type React from "react";
import { useCallback, useRef, useState } from "react";

import { clampSnapPct } from "./resize-pct";

interface UseInlineResize {
  /** Live % during a drag (null when idle) — for a label / preview width. */
  dragPct: null | number;
  /** mousedown handler for the right-edge handle. */
  startResize: (e: React.MouseEvent) => void;
}

/**
 * Width (%) for a LEFT-ANCHORED inline element given the cursor X, the
 * element's own left edge, and the width the percentage resolves against
 * (its containing block). The left edge is fixed by the surrounding text, so
 * the width is simply how far right of it the cursor is — no doubling. Clamped
 * to 10–100% and snapped to the nearest 10% within ±3%, exactly as the media
 * handles do.
 */
export function computeInlineResizePct(
  cursorX: number,
  leftX: number,
  containerW: number,
): number {
  if (containerW <= 0) return 100;
  return clampSnapPct(((cursorX - leftX) / containerW) * 100);
}

/**
 * Notion-style right-edge resize for an inline element. WKWebView breaks HTML5
 * DnD, so this is mouse-event driven like useMediaResize. `elementRef` is the
 * element being resized; its parent supplies the width the committed
 * percentage will resolve against, so both are measured once at mousedown and
 * the live preview cannot feed back into its own geometry. `onCommit` fires on
 * mouseup only if the pointer actually moved — a plain click must never change
 * the width.
 *
 * Unlike useMediaResize there is no post-drag click to swallow: the block
 * reference only reacts to Cmd/Ctrl+click, so the synthetic click the browser
 * fires after a drag reaches a handler that does nothing.
 */
export function useInlineResize(
  elementRef: React.RefObject<HTMLElement | null>,
  onCommit: (pct: number) => void,
): UseInlineResize {
  const [dragPct, setDragPct] = useState<null | number>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const el = elementRef.current;
      const container = el?.parentElement;
      if (!el || !container) return;
      const leftX = el.getBoundingClientRect().left;
      const containerW = container.getBoundingClientRect().width;
      if (containerW <= 0) return;
      let committed: null | number = null;

      const onMove = (ev: MouseEvent) => {
        committed = computeInlineResizePct(ev.clientX, leftX, containerW);
        setDragPct(committed);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        setDragPct(null);
        if (committed != null) onCommitRef.current(committed);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [elementRef],
  );

  return { dragPct, startResize };
}
