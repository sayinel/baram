// issue 521 — one context menu at a time, across the document-level MenuList
// and the NodeViews that run their own (mermaid, svg).
//
// Every menu dismisses itself on document mousedown. But a diagram block in
// preview state stops the right-button mousedown at its wrapper — so that
// ProseMirror does not select it and flip it into editing — and that same
// stop hides the mousedown from every OTHER menu's dismiss listener. Open a
// menu on block A, right-click block B: A's menu stayed open next to B's,
// Delete and all, each bound to a different block.
//
// So whoever is about to open a menu, or to yield a right-click to the
// browser's native menu, says so on the document first, and every open menu
// closes on that signal. The signal is synchronous; the opener sets its own
// state right after, so its own close (if it was open) is simply overwritten.
const CLOSE_ALL_EVENT = "baram:context-menu-close-all";

/** Close every open context menu. Call right before opening one, or right
 *  before yielding a right-click to the browser. */
export function closeAllContextMenus(): void {
  document.dispatchEvent(new Event(CLOSE_ALL_EVENT));
}

/** Subscribe an OPEN menu's close handler; returns the unsubscribe. Register
 *  it only while the menu is open, next to the mousedown/Escape dismiss. */
export function onCloseAllContextMenus(close: () => void): () => void {
  document.addEventListener(CLOSE_ALL_EVENT, close);
  return () => document.removeEventListener(CLOSE_ALL_EVENT, close);
}
