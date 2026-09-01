// Heading & List Folding — mousedown handler for fold arrow / ellipsis clicks

import type { EditorView } from "@tiptap/pm/view";

import { dispatchToggleFold } from "./fold-commands";
import { getFoldRange } from "./fold-ranges";

export function handleFoldMousedown(
  view: EditorView,
  event: MouseEvent,
): boolean {
  const target = event.target as HTMLElement;
  if (!target) return false;

  const foldEl = target.closest(".fold-arrow, .fold-ellipsis");
  if (!foldEl) {
    // §perf-large-file C4: heading arrows are CSS pseudo-elements with no
    // DOM node, so a click on a heading's gutter cannot be detected via
    // `closest()`. Resolve it by coordinate instead.
    const headingPos = resolveHeadingGutterFold(view, event);
    if (headingPos === null) return false;
    event.preventDefault();
    event.stopPropagation();
    dispatchToggleFold(view, headingPos);
    return true;
  }

  // §perf-large-file C3: Resolve the heading/listItem position at click
  // time rather than reading the potentially-stale `data-fold-pos`
  // attribute (which was written at decoration-creation time and is not
  // updated when edits above this widget shift doc positions).
  //
  // Strategy: walk up from the widget element to the nearest <li>/<hN>
  // block it lives in, then use posAtDOM + resolve to that block's OWN
  // start position. A list item lives at depth ≥2 (doc > list >
  // listItem), so the previous "walk to the editor's direct child +
  // before(1)" returned the parent LIST's position, not the listItem's,
  // and the toggle dispatch silently no-op'd. Resolve to the innermost
  // heading/listItem ancestor depth instead. Fall back to the attribute
  // only if resolution fails.
  let pos: null | number = null;
  try {
    const blockEl = (foldEl as HTMLElement).closest(
      "li, h1, h2, h3, h4, h5, h6",
    );
    if (blockEl instanceof HTMLElement && view.dom.contains(blockEl)) {
      const rawPos = view.posAtDOM(blockEl, 0);
      const $resolved = view.state.doc.resolve(rawPos);
      for (let d = $resolved.depth; d >= 1; d--) {
        const ancestor = $resolved.node(d);
        if (
          ancestor.type.name === "listItem" ||
          ancestor.type.name === "heading"
        ) {
          pos = $resolved.before(d);
          break;
        }
      }
    }
  } catch {
    pos = null;
  }

  // Fallback: use the attribute (may be stale but better than nothing).
  if (pos === null) {
    const attrPos = Number(foldEl.getAttribute("data-fold-pos"));
    if (!isNaN(attrPos)) pos = attrPos;
  }

  if (pos === null) return false;

  event.preventDefault();
  event.stopPropagation();
  dispatchToggleFold(view, pos);
  return true;
}

/**
 * §perf-large-file C4: detect a click on a top-level heading's gutter fold
 * arrow, rendered as a CSS pseudo-element (`.tiptap > hN::before`, which is
 * `pointer-events: auto`). Returns the heading's doc position when a FOLDABLE
 * heading's gutter arrow was clicked, else null.
 *
 * MUST stay coordinate-free: `.editor-area-scroll` uses CSS `zoom`, under which
 * WKWebView's `MouseEvent.clientX` / `getBoundingClientRect()` / `posAtCoords`
 * live in mismatched coordinate spaces (see [[wkwebview-css-zoom-coords]]) — so
 * the earlier `posAtCoords` + rect approach silently never fired. Instead:
 *   1. A click on the `::before` arrow reports `event.target` === the heading
 *      element (pseudo-elements forward events to their host).
 *   2. `event.offsetX < 0` means the click landed left of the heading's content
 *      box, i.e. in the gutter where the arrow sits. The SIGN of offsetX is
 *      invariant under any positive `zoom`, so this needs no zoom math.
 *   3. The heading's doc position is resolved via `posAtDOM` (DOM-based, also
 *      zoom-safe), exactly as the list-item/ellipsis widget path does.
 */
function resolveHeadingGutterFold(
  view: EditorView,
  event: MouseEvent,
): null | number {
  const target = event.target as HTMLElement | null;
  const heading = target?.closest("h1, h2, h3, h4, h5, h6");
  if (!(heading instanceof HTMLElement) || !view.dom.contains(heading)) {
    return null;
  }
  // Only the gutter (left of the heading content box) toggles; clicks on the
  // heading text fall through to normal cursor placement.
  if (event.offsetX >= 0) return null;

  let topPos: number;
  try {
    const rawPos = view.posAtDOM(heading, 0);
    const $resolved = view.state.doc.resolve(rawPos);
    topPos = $resolved.depth > 0 ? $resolved.before(1) : rawPos;
  } catch {
    return null;
  }

  // Only foldable headings toggle (don't pollute foldedPositions with headings
  // that have no content to fold).
  if (!getFoldRange(view.state.doc, topPos)) return null;
  return topPos;
}
