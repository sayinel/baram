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
// query builder's selects and limit input, the code block's language select,
// and any control a document itself places through an HTML block: for all
// of them the app menu acted on the ProseMirror selection, not on the
// control. Checkboxes and radios are excluded in advance — none exist in the
// editor today (the task item's control is a <button>, unaffected either
// way).
const NATIVE_TEXT_CONTROL_SELECTOR =
  'textarea, select, input:not([type="checkbox"]):not([type="radio"])';

/** True when `target` is, or sits inside, a native text control. */
export function isInNativeTextControl(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(NATIVE_TEXT_CONTROL_SELECTOR) !== null
  );
}
