// §276.6 Edge-drag resize for an element that sits INLINE in a paragraph — the
// area-highlight block reference. Deliberately separate from useMediaResize:
// that hook is for a centred block and derives the width from twice the
// cursor's distance to the centre, which for a left-anchored element would
// double it. The clamp/snap policy is shared (resize-pct.ts) so both handles
// feel the same.
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { clampSnapPct } from "./resize-pct";
import { swallowNextClick } from "./swallow-next-click";

interface UseInlineResize {
  /** Live % during a drag (null when idle) — for a label / preview width. */
  dragPct: null | number;
  /** mousedown handler for the right-edge handle. */
  startResize: (e: React.MouseEvent) => void;
}

/**
 * Displays that establish a containing block for a percentage width. An
 * allowlist rather than a list of inline displays to skip, and deliberately so:
 * an unknown display treated as a containing block reintroduces CRITICAL-1,
 * while an unknown display skipped over merely measures a wider ancestor.
 */
const BLOCK_CONTAINER_DISPLAYS = new Set([
  "block",
  "flex",
  "flow-root",
  "grid",
  "inline-block",
  "inline-flex",
  "inline-grid",
  "inline-table",
  "list-item",
  "table",
  "table-caption",
  "table-cell",
]);

/**
 * Width (%) for a LEFT-ANCHORED inline element given the cursor X, the
 * element's own left edge, and the width the percentage resolves against
 * (its containing block — see resolveContainingBlock, NOT `parentElement`).
 * The left edge is fixed by the surrounding text, so the width is simply how
 * far right of it the cursor is — no doubling. Clamped to 10–100% and snapped
 * to the nearest 10% within ±3%, exactly as the media handles do.
 *
 * The reachable maximum is positional: a reference starting 40% into a line
 * tops out near 60%, because the cursor runs out of paragraph before the
 * percentage runs out of range. That is fine and must not be "fixed" by
 * re-anchoring to the paragraph's left edge — doing so would make the live %
 * label disagree with the grip under the cursor on every mid-line drag.
 * `.block-reference[data-area-preview]` is an `inline-block` with
 * `max-width: 100%`, so the moment a committed width exceeds what is left on
 * the line the element wraps to a line of its own, where `leftX` becomes the
 * paragraph's left edge and the full 10–100 range is reachable on the next
 * drag. The user is never stuck.
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
 * The ancestor a percentage width on `el` actually resolves against: the
 * nearest one that establishes a containing block.
 *
 * ‼️ NOT `el.parentElement`. @tiptap/react wraps every React NodeView in a
 * `span.react-renderer` (ReactNodeView.mount requires the NodeViewWrapper to be
 * its firstElementChild), and that span has no CSS rule anywhere in this
 * codebase — it is `display: inline`, so its box is exactly its one
 * inline-block child: the reference being dragged. Measuring it made the drag
 * self-referential (grabbing the handle read 100% immediately) and committed a
 * fraction of the CROP as though it were a fraction of the PARAGRAPH, which is
 * what the CSS percentage resolves against.
 */
export function resolveContainingBlock(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (BLOCK_CONTAINER_DISPLAYS.has(getComputedStyle(node).display)) {
      return node;
    }
  }
  return null;
}

/**
 * Notion-style right-edge resize for an inline element. WKWebView breaks HTML5
 * DnD, so this is mouse-event driven like useMediaResize. `elementRef` is the
 * element being resized; its containing block supplies the width the committed
 * percentage will resolve against, and both are measured once at mousedown so
 * the live preview cannot feed back into its own geometry. `onCommit` fires on
 * mouseup only if the pointer actually moved — a plain click must never change
 * the width — and the callback is re-read at commit time, so a caller can still
 * refuse the write from state that changed mid-drag.
 */
export function useInlineResize(
  elementRef: React.RefObject<HTMLElement | null>,
  onCommit: (pct: number) => void,
): UseInlineResize {
  const [dragPct, setDragPct] = useState<null | number>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  // Teardown for a drag that is still in flight. A NodeView is destroyed out
  // from under a drag routinely — a tab switch runs `view.updateState()`, which
  // recreates every NodeView in the document — and without this the document
  // listeners outlive it and commit into a dead view.
  const detachRef = useRef<(() => void) | null>(null);
  useEffect(() => () => detachRef.current?.(), []);

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const el = elementRef.current;
      if (!el) return;
      const container = resolveContainingBlock(el);
      if (!container) return;
      const leftX = el.getBoundingClientRect().left;
      const containerW = container.getBoundingClientRect().width;
      if (containerW <= 0) return;
      let committed: null | number = null;

      const onMove = (ev: MouseEvent) => {
        committed = computeInlineResizePct(ev.clientX, leftX, containerW);
        setDragPct(committed);
      };
      const detach = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        detachRef.current = null;
      };
      const onUp = () => {
        detach();
        setDragPct(null);
        if (committed == null) return;
        onCommitRef.current(committed);
        // The browser fires a `click` on the common ancestor of the press and
        // release targets once the drag ends — here, the reference itself. Its
        // onClick navigates on Cmd/Ctrl+click, so a drag with the modifier held
        // would resize AND jump away. Swallow that one click.
        swallowNextClick();
      };
      // Unmount tears the listeners down WITHOUT committing: a width measured
      // against a layout that no longer exists is not worth writing to disk.
      detachRef.current = detach;
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [elementRef],
  );

  return { dragPct, startResize };
}
