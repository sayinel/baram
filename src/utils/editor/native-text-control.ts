// issue 521 — the one definition of "a native text control whose right-click
// belongs to the browser" (copy, paste, select all). Shared by the
// document-level ContextMenu and the NodeViews that run their own right-click
// menu (mermaid, svg), so the two layers cannot disagree about a target: the
// NodeView lets such a click bubble untouched, the document handler then
// steps aside without preventDefault, and the native menu appears.
//
// The rule is deliberately blanket. In the editor today it covers every
// NodeView textarea (mermaid, svg, HTML block, block embed — but not the
// math blocks', which the document handler's special-node check claims
// first), the caption and title inputs, the frontmatter and tag inputs, the
// query builder's limit input, and any text control a document itself
// places through an HTML block: for all of them the app menu acted on the
// ProseMirror selection, not on the control. Checkboxes and radios are
// excluded in advance — none exist in the editor today (the task item's
// control is a <button>, unaffected either way).
//
// A <select> (the code block's language, the query builder's fields) is
// different: it has no text to copy or paste, so the browser offers its PAGE
// menu there — in this app just "Reload" — and our menu was as wrong as
// before. Neither is worth showing, so a right-click on a select is
// swallowed: isInNativeSelect, checked before the text-control rule.
const NATIVE_TEXT_CONTROL_SELECTOR =
  'textarea, input:not([type="checkbox"]):not([type="radio"])';

/** True when `target` is, or sits inside, a native <select>. */
export function isInNativeSelect(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("select") !== null;
}

/** True when `target` is, or sits inside, a native text control. */
export function isInNativeTextControl(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(NATIVE_TEXT_CONTROL_SELECTOR) !== null
  );
}
