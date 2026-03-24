/**
 * Original doc tracking for dirty detection.
 *
 * Instead of timing-based suppression, we store the ProseMirror doc
 * at load time and compare via doc.eq() on each update event.
 * If the doc hasn't changed from the original, it's not dirty.
 * If it has changed (user edit OR roundtrip difference), it's legitimately dirty.
 */
import type { Node } from "@tiptap/pm/model";

const originalDocs = new Map<string, Node>();

/** Clean up when tab is closed */
export function clearOriginalDoc(tabId: string): void {
  originalDocs.delete(tabId);
}

/** Check if current doc is unchanged from the loaded original */
export function isDocUnchanged(tabId: string, currentDoc: Node): boolean {
  const original = originalDocs.get(tabId);
  if (!original) return false;
  return original.eq(currentDoc);
}

/** Store the original doc after loading content into the editor */
export function setOriginalDoc(tabId: string, doc: Node): void {
  originalDocs.set(tabId, doc);
}

/** Update the original doc (e.g., after save — saved content becomes the new baseline) */
export function updateOriginalDoc(tabId: string, doc: Node): void {
  originalDocs.set(tabId, doc);
}
