/**
 * Original doc tracking for dirty detection.
 *
 * After updateState, ProseMirror's DOMObserver may create a slightly different
 * doc (e.g., image NodeViews normalize DOM). We store the original doc LAZILY:
 * mark a tab as "pending", then on the FIRST editor update event after loading,
 * capture the stabilized doc as the baseline. Subsequent updates compare against
 * this stable baseline.
 */
import type { Node } from "@tiptap/pm/model";

const originalDocs = new Map<string, Node>();
const pendingTabs = new Set<string>();
const loadingTabs = new Set<string>();

/** Clean up when tab is closed */
export function clearOriginalDoc(tabId: string): void {
  originalDocs.delete(tabId);
  pendingTabs.delete(tabId);
  loadingTabs.delete(tabId);
}

/** Read the baseline doc (last saved/loaded) — used as the 3-way merge base */
export function getOriginalDoc(tabId: string): Node | undefined {
  return originalDocs.get(tabId);
}

export function isTabLoading(tabId: string): boolean {
  return loadingTabs.has(tabId);
}

/** Mark a tab as having just loaded content — the next update will capture baseline */
export function markContentLoaded(tabId: string): void {
  pendingTabs.add(tabId);
}

/** Mark a tab as currently loading (progressive render in flight). While set,
 *  shouldSkipDirty() returns true so append transactions never mark dirty. */
export function setTabLoading(tabId: string, loading: boolean): void {
  if (loading) loadingTabs.add(tabId);
  else loadingTabs.delete(tabId);
}

/**
 * Called on every editor update event.
 * Returns true if this update should NOT mark dirty (either capturing baseline
 * or doc unchanged from baseline).
 */
export function shouldSkipDirty(tabId: string, currentDoc: Node): boolean {
  // Suppress dirty during progressive load
  if (loadingTabs.has(tabId)) return true;

  // First update after content load — capture stabilized doc as baseline
  if (pendingTabs.has(tabId)) {
    pendingTabs.delete(tabId);
    originalDocs.set(tabId, currentDoc);
    return true;
  }

  // Compare with stored baseline.
  // §perf-large-file C4: `Node.eq()` is a deep structural walk of the WHOLE
  // document, and this runs on EVERY keystroke (via the auto-save `update`
  // listener). On a ~21k-line doc that walk costs ~100ms+/keystroke — the
  // flag-independent typing-latency floor that block virtualization could never
  // touch (it is JS, not DOM layout). Guard it with an O(1) `content.size`
  // pre-check: a baseline of a different size is unequal without walking, and
  // since `eq()` implies equal size this stays behaviour-identical — it only
  // skips the walk in the common case (typing changes the total size).
  const original = originalDocs.get(tabId);
  if (
    original &&
    original.content.size === currentDoc.content.size &&
    original.eq(currentDoc)
  ) {
    return true;
  }

  return false;
}

/** Update the baseline doc (e.g., after save) */
export function updateOriginalDoc(tabId: string, doc: Node): void {
  originalDocs.set(tabId, doc);
}
