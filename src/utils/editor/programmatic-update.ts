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

/**
 * Transaction meta key set by the table colwidth auto-init plugin
 * (createColResizePlugin). Transactions carrying this meta apply auto-measured
 * colwidths with `userResized: false` — load-time normalization that is never
 * serialized back to markdown — so they must never mark a tab dirty. The
 * auto-save update handler routes these to noteColwidthInit() instead of the
 * dirty path.
 */
export const COLWIDTH_AUTO_INIT_META = "colwidthAutoInit";

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

/**
 * Called when an auto-colwidth-init transaction fires (see createColResizePlugin
 * and COLWIDTH_AUTO_INIT_META). Auto-measured colwidth is load-time
 * normalization, not a user edit, so it must never mark the tab dirty.
 *
 * We fold it into the baseline: consume any pending capture and re-sync the
 * baseline to the current (colwidth-applied) doc, so later REAL edits still
 * compare correctly. This is what makes per-table colwidth dispatches safe — a
 * multi-table file emits one colwidth tx PER table, and folding each one into
 * the baseline prevents the 2nd+ table from being mistaken for a user edit.
 *
 * Ignored while the tab is still loading: the doc is partial then, and the full
 * baseline is captured at finishLoad time via markContentLoaded().
 */
export function noteColwidthInit(tabId: string, doc: Node): void {
  if (loadingTabs.has(tabId)) return;
  pendingTabs.delete(tabId);
  originalDocs.set(tabId, doc);
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
