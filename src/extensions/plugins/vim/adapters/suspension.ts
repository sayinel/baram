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

// The marker NAMES live in a dependency-free leaf (utils/vim-island-markers):
// they are a security constant the sanitizers must strip whether or not vim
// is enabled, so they cannot be owned by this feature module — see the
// leaf's own note.
import {
  BODY_MARKER,
  SUSPEND_MARKER,
} from "../../../../utils/vim-island-markers";

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

/** Known non-vim islands, outermost wrapper → StatusBar label. Code blocks
 *  are deliberately absent: their CodeMirror runs its own vim and claims the
 *  indicator through the island layer (vim-status), so labelling them here
 *  would only flash a wrong INSERT before that claim lands. */
const ISLAND_LABELS: readonly (readonly [string, string])[] = [
  [".math-block", "math"],
  ['[data-type="mermaidBlock"]', "mermaid"],
  ['[data-type="svgBlock"]', "svg"],
  ['[data-type="htmlBlock"]', "html"],
  ['[data-type="queryBlock"]', "query"],
];

/**
 * StatusBar label for the island a focus event landed in, null when the host
 * block is not one of the known plain islands. Drives `-- INSERT (math) --`:
 * a plain textarea island is effectively insert mode, and without the label
 * the mode line keeps claiming NORMAL while keys go into the island — the
 * one place it lies (§8, design v3 follow-up).
 */
export function islandLabel(event: Event): null | string {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  for (const [selector, label] of ISLAND_LABELS) {
    if (target.closest(selector)) return label;
  }
  return null;
}
