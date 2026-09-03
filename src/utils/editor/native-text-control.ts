// issue 521 — the one definition of "a native text control whose right-click
// belongs to the browser" (copy, paste, select all). Shared by the
// document-level ContextMenu and the NodeViews that run their own right-click
// menu (mermaid, svg), so the two layers cannot disagree about a target: the
// NodeView lets such a click bubble untouched, the document handler then
// steps aside without preventDefault, and the native menu appears.
//
// Checkboxes and radios are excluded in advance — none exist in the editor
// today (the task item's control is a <button>, unaffected either way).
const NATIVE_TEXT_CONTROL_SELECTOR =
  'textarea, select, input:not([type="checkbox"]):not([type="radio"])';

/** True when `target` is, or sits inside, a native text control. */
export function isInNativeTextControl(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(NATIVE_TEXT_CONTROL_SELECTOR) !== null
  );
}
