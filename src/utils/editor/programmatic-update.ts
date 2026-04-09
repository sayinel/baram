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

/** Clean up when tab is closed */
export function clearOriginalDoc(tabId: string): void {
  originalDocs.delete(tabId);
  pendingTabs.delete(tabId);
}

/** Mark a tab as having just loaded content — the next update will capture baseline */
export function markContentLoaded(tabId: string): void {
  pendingTabs.add(tabId);
}

/**
 * Called on every editor update event.
 * Returns true if this update should NOT mark dirty (either capturing baseline
 * or doc unchanged from baseline).
 */
export function shouldSkipDirty(tabId: string, currentDoc: Node): boolean {
  // First update after content load — capture stabilized doc as baseline
  if (pendingTabs.has(tabId)) {
    pendingTabs.delete(tabId);
    originalDocs.set(tabId, currentDoc);
    return true;
  }

  // Compare with stored baseline
  const original = originalDocs.get(tabId);
  if (original && original.eq(currentDoc)) return true;

  return false;
}

/** Update the baseline doc (e.g., after save) */
export function updateOriginalDoc(tabId: string, doc: Node): void {
  originalDocs.set(tabId, doc);
}
