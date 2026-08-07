// §298 Vim Phase 1 — z-family view scrolling + cursor follow (device R7,
// reviews ops-R8/R9).
//
// Pure view work — no transaction, no state. Two entry points:
// scrollCursorToCenter (zz / z.) and scrollCursorIntoView (every motion,
// find, edit landing and history restore — PM's own scroll pipeline bails
// when the DOM selection sits outside a non-editable view, i.e. vim modal).

import type { EditorView } from "@tiptap/pm/view";

import { getEditorZoom } from "../../../../utils/zoom-coords";
import { revealBlockInActiveEditor } from "../../viewport-virtualize";

/** The follow scroll also resolves the cursor's own DOM node: a wide table
 *  scrolls inside a DESCENDANT wrapper that ancestor walks from view.dom
 *  can never reach (ops-R9). */
type FollowableView = Pick<EditorView, "coordsAtPos" | "dom" | "domAtPos">;

/** What zz needs — narrow for testability. */
type MeasurableView = Pick<EditorView, "coordsAtPos" | "dom">;

/** Keep the cursor this far off the container edge (CONTENT pixels —
 *  PM's own scrollMargin default). */
const SCROLL_MARGIN = 5;

/**
 * Vim's cursor-follow scroll — nearest-edge, replacing PM's default while
 * vim owns the surface. Walks the scrollable ancestors FROM the cursor's
 * own DOM node so nested scrollports (table wrappers) correct their own
 * axes, re-measuring after every real adjustment; the walk ends at the
 * editor's vertical scroller. No-op when the cursor is already in view.
 */
export function scrollCursorIntoView(
  view: FollowableView,
  pos: number,
  zoom = getEditorZoom(),
): void {
  let coords = measureOrReveal(view, pos);
  if (!coords) return;
  const margin = SCROLL_MARGIN * zoom; // compared in visual space
  const outer = scrollParentOf(view.dom);
  let el: HTMLElement | null = elementAt(view, pos);
  for (; el; el = el.parentElement) {
    if (adjustScrollport(el, coords, margin, zoom)) {
      const next = measure(view, pos);
      if (!next) break;
      coords = next;
    }
    if (el === outer) break;
  }
}

/** Scrolls so the cursor line sits at the CENTER of its scroll container.
 *  Layout-less environments (jsdom) and views without a scrollable
 *  ancestor no-op safely. Coordinates are SCALED visual space under the
 *  editor's CSS zoom while scrollTop is content-space
 *  (src/utils/zoom-coords.ts) — the delta divides by the zoom. */
export function scrollCursorToCenter(
  view: MeasurableView,
  pos: number,
  zoom = getEditorZoom(),
): void {
  const coords = measureOrReveal(view, pos);
  if (!coords) return;
  const parent = scrollParentOf(view.dom);
  if (!parent) return;
  const rect = parent.getBoundingClientRect();
  parent.scrollTop += (coords.top - (rect.top + rect.height / 2)) / zoom;
}

/** The nearest ancestor that actually scrolls vertically. */
export function scrollParentOf(dom: HTMLElement): HTMLElement | null {
  for (let el = dom.parentElement; el; el = el.parentElement) {
    if (
      scrollsOn(
        getComputedStyle(el).overflowY,
        el.scrollHeight,
        el.clientHeight,
      )
    ) {
      return el;
    }
  }
  return null;
}

/** Corrects both axes of ONE scrollport; true when anything moved. */
function adjustScrollport(
  el: HTMLElement,
  coords: { bottom: number; left: number; right: number; top: number },
  margin: number,
  zoom: number,
): boolean {
  const style = getComputedStyle(el);
  const beforeTop = el.scrollTop;
  const beforeLeft = el.scrollLeft;
  if (scrollsOn(style.overflowY, el.scrollHeight, el.clientHeight)) {
    const rect = el.getBoundingClientRect();
    if (coords.top < rect.top + margin) {
      el.scrollTop += (coords.top - (rect.top + margin)) / zoom;
    } else if (coords.bottom > rect.bottom - margin) {
      el.scrollTop += (coords.bottom - (rect.bottom - margin)) / zoom;
    }
  }
  if (scrollsOn(style.overflowX, el.scrollWidth, el.clientWidth)) {
    const rect = el.getBoundingClientRect();
    if (coords.left < rect.left + margin) {
      el.scrollLeft += (coords.left - (rect.left + margin)) / zoom;
    } else if (coords.right > rect.right - margin) {
      el.scrollLeft += (coords.right - (rect.right - margin)) / zoom;
    }
  }
  return el.scrollTop !== beforeTop || el.scrollLeft !== beforeLeft;
}

/** The cursor's own element — the start of the scrollport walk. */
function elementAt(view: FollowableView, pos: number): HTMLElement {
  try {
    const { node } = view.domAtPos(pos);
    if (node instanceof HTMLElement) return node;
    return node.parentElement ?? view.dom;
  } catch {
    return view.dom;
  }
}

/** Visual-space cursor rect, or null when unmeasurable — hidden layout
 *  reports ZEROS, it does not throw (review device-R7). */
function measure(
  view: MeasurableView,
  pos: number,
): null | { bottom: number; left: number; right: number; top: number } {
  try {
    const coords = view.coordsAtPos(pos);
    return coords.top === 0 && coords.bottom === 0 ? null : coords;
  } catch {
    return null;
  }
}

/** Measure, revealing a windowed block ONLY on failure — revealBlock
 *  rebuilds the whole window band (a forced-layout path), so an in-band
 *  cursor must never trigger it (review ops-R9). */
function measureOrReveal(
  view: MeasurableView,
  pos: number,
): null | { bottom: number; left: number; right: number; top: number } {
  const first = measure(view, pos);
  if (first) return first;
  revealBlockInActiveEditor(pos);
  return measure(view, pos);
}

function scrollsOn(overflow: string, scrollSize: number, clientSize: number) {
  return (
    (overflow === "auto" || overflow === "scroll" || overflow === "overlay") &&
    scrollSize > clientSize
  );
}
