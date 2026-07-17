/**
 * Original doc tracking for dirty detection.
 *
 * After updateState, ProseMirror's DOMObserver may create a slightly different
 * doc (e.g., image NodeViews normalize DOM). We store the original doc LAZILY:
 * mark a tab as "pending", then on the FIRST editor update event after loading,
 * capture the stabilized doc as the baseline. Subsequent updates compare against
 * this stable baseline.
 *
 * The first update is not always normalization, though — it can be a genuine
 * user edit (e.g. resizing a media block as the first action). shouldSkipDirty
 * disambiguates the two by serialized markdown so a real first edit still marks
 * dirty instead of being absorbed. See its doc comment.
 */
import type { Node } from "@tiptap/pm/model";

const originalDocs = new Map<string, Node>();
const pendingTabs = new Set<string>();
const loadingTabs = new Set<string>();

/**
 * Listeners notified after a tab's content is (re)loaded into the editor.
 *
 * Tab switches and source-mode swaps install content via a direct
 * `editor.view.updateState()`, which bypasses Tiptap's `update`/`selectionUpdate`
 * events AND reuses the same (stable-reference) shared editor. UI derived from
 * doc content — e.g. the status-bar word count — therefore has no editor event
 * to react to on a switch. Subscribing to this signal fills that gap.
 */
const contentLoadedListeners = new Set<(tabId: string) => void>();

/** Subscribe to content-loaded notifications. Returns an unsubscribe function. */
export function subscribeContentLoaded(
  fn: (tabId: string) => void,
): () => void {
  contentLoadedListeners.add(fn);
  return () => {
    contentLoadedListeners.delete(fn);
  };
}

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
  // Called synchronously right after the content is installed into the editor,
  // so listeners read the freshly-loaded doc. See contentLoadedListeners.
  for (const fn of contentLoadedListeners) fn(tabId);
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
 *
 * `firstEdit` lets the caller distinguish DOM-stabilization noise from a genuine
 * first user edit on the pending-baseline update (see below). It is only
 * consulted once per load (when the pending capture fires), so `markdownEqual`
 * — which serializes the whole doc — never runs per-keystroke.
 */
export function shouldSkipDirty(
  tabId: string,
  currentDoc: Node,
  firstEdit?: {
    /** Doc before this transaction's steps (transaction.before). */
    beforeDoc: Node;
    /** True when the two docs serialize to identical markdown. */
    markdownEqual: (before: Node, after: Node) => boolean;
  },
): boolean {
  // Suppress dirty during progressive load
  if (loadingTabs.has(tabId)) return true;

  // First update after content load. This is normally DOMObserver
  // normalization (e.g. NodeView DOM tidy-ups) that we absorb as the baseline.
  // BUT a genuine user edit can also BE this first update — most visibly an
  // attr-only media resize/caption done as the first action, which leaves
  // content.size unchanged and so would otherwise be silently swallowed and
  // never mark dirty. Disambiguate by serialized markdown: if the edit changed
  // the markdown it is real → keep the pre-edit doc as the baseline and mark
  // dirty; if markdown is unchanged it is normalization noise → absorb it.
  if (pendingTabs.has(tabId)) {
    pendingTabs.delete(tabId);
    if (
      firstEdit &&
      !firstEdit.markdownEqual(firstEdit.beforeDoc, currentDoc)
    ) {
      originalDocs.set(tabId, firstEdit.beforeDoc);
      return false;
    }
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
