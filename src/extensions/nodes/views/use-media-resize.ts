import type React from "react";
import { useCallback, useRef, useState } from "react";

interface UseMediaResize {
  /** Live % during a drag (null when idle) — for a label / preview width. */
  dragPct: null | number;
  /** mousedown handler for an edge handle. */
  startResize: (e: React.MouseEvent) => void;
}

/**
 * Width (%) for a centered media block given the cursor X, the block's centre X,
 * and the available container width. Centered ⇒ width tracks twice the cursor's
 * distance from the centre, so either edge handle uses the same maths. Clamped
 * to 10–100% with a light snap to the nearest 10% (within ±3%), then rounded.
 */
export function computeResizePct(
  cursorX: number,
  centerX: number,
  containerW: number,
): number {
  if (containerW <= 0) return 100;
  // Round to an integer percent first so the ±3% snap window is exact (floating
  // point can otherwise put a boundary value like 57% at distance 3.0000…1).
  let pct = Math.round(((2 * Math.abs(cursorX - centerX)) / containerW) * 100);
  pct = Math.max(10, Math.min(100, pct));
  const nearest = Math.round(pct / 10) * 10;
  if (Math.abs(pct - nearest) <= 3) pct = nearest;
  return pct;
}

/**
 * Notion-style edge-drag resize for a centered media block. WKWebView breaks
 * HTML5 DnD, so this is driven by mouse events. `containerRef` is the full-width
 * element the block is centered within; `onCommit` receives the final % on
 * mouseup (only if the pointer actually moved).
 */
export function useMediaResize(
  containerRef: React.RefObject<HTMLElement | null>,
  onCommit: (pct: number) => void,
): UseMediaResize {
  const [dragPct, setDragPct] = useState<null | number>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const containerW = rect.width;
      if (containerW <= 0) return;
      let committed: null | number = null;

      const onMove = (ev: MouseEvent) => {
        committed = computeResizePct(ev.clientX, centerX, containerW);
        setDragPct(committed);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        setDragPct(null);
        if (committed != null) {
          onCommitRef.current(committed);
          // A drag ends with the browser firing a `click` on the common
          // ancestor of the press/release targets — i.e. the media block. That
          // would reach the block's own onClick (SVG/Mermaid select → edit
          // mode). Swallow just that one click in the capture phase so it never
          // reaches React's handler.
          swallowNextClick();
        }
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [containerRef],
  );

  return { dragPct, startResize };
}

/**
 * Cancel the single `click` the browser synthesizes right after a drag, before
 * it reaches any React handler. Registered in the capture phase on window (which
 * fires ahead of React's root listener), self-removing on the first click, with
 * a short safety timeout in case no click follows (e.g. some drags).
 */
function swallowNextClick(): void {
  const swallow = (ev: MouseEvent) => {
    ev.stopPropagation();
    ev.preventDefault();
    cleanup();
  };
  const cleanup = () => {
    window.removeEventListener("click", swallow, true);
    clearTimeout(timer);
  };
  const timer = setTimeout(cleanup, 300);
  window.addEventListener("click", swallow, true);
}
