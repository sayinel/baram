// §298 Vim Phase 1 — suspension (design §4).
//
// NodeViews host input islands (tag inputs, captions, math textareas, CM
// containers) that must own their keys while focused. Inference was
// abandoned in review round 2: islands carry an explicit `data-vim-suspend`
// marker, PM body content carries Tiptap's `data-node-view-content`, and the
// FIRST of the two found walking composedPath() outward decides. Third-party
// NodeViews without a marker are documented as unsupported (extensions/
// CLAUDE.md).
//
// Release is NOT focusout-synchronous: moving focus between controls inside
// one island (input → its button) fires focusout first, and resuming vim for
// that instant would steal the next key. The caller re-evaluates the active
// element on a microtask instead (design §4), via `shouldSuspendFor`.

const SUSPEND_MARKER = "data-vim-suspend";
const BODY_MARKER = "data-node-view-content";

/**
 * Island membership is an APP capability, never document content: these
 * attributes decide who owns the modal keyboard. DOMPurify keeps `data-*`
 * and `tabindex` by default, so sanitized HTML/SVG from a shared file could
 * otherwise grant itself suspension — or deny it inside a real island and
 * leave vim reading the user's keystrokes as commands. Sanitizers strip
 * them (dedicated security review); this module stays the single source of
 * the marker names.
 */
export const VIM_ISLAND_MARKERS = [SUSPEND_MARKER, BODY_MARKER];

/**
 * True when the event target sits inside an input island. Walks the
 * composed path from the target OUTWARD; the first marker wins, so an
 * island nested inside NodeView content still suspends, and body content
 * inside a marked wrapper still gets vim.
 */
export function isSuspendTarget(event: Event): boolean {
  const path = event.composedPath();
  for (const entry of path) {
    const verdict = markerOn(entry);
    if (verdict !== null) return verdict;
  }
  return false;
}

/**
 * Focus-side twin of isSuspendTarget for the microtask re-evaluation:
 * decides for the element that HOLDS focus after the dust settles.
 * `null` element (focus left the document) never suspends.
 */
export function shouldSuspendFor(element: Element | null): boolean {
  let current: Element | null = element;
  while (current) {
    const verdict = markerOn(current);
    if (verdict !== null) return verdict;
    // Escape shadow DOM: the host carries the marker per the §4 contract.
    current =
      current.parentElement ??
      (current.getRootNode() instanceof ShadowRoot
        ? ((current.getRootNode() as ShadowRoot).host ?? null)
        : null);
  }
  return false;
}

/** suspend / body / unmarked — the §4 dispatch, one node at a time. */
function markerOn(entry: unknown): boolean | null {
  if (!(entry instanceof Element)) return null;
  if (entry.hasAttribute(SUSPEND_MARKER)) return true;
  if (entry.hasAttribute(BODY_MARKER)) return false;
  return null;
}
