// §5.12 HTML Export — where the document ends and the editor begins.

/**
 * Is this element part of the DOCUMENT rather than part of the editor?
 *
 * ‼️ An HTML block renders the author's own (sanitized) markup verbatim —
 * html-block-view.tsx sets it with `dangerouslySetInnerHTML` into
 * `.html-block-render`. A `<button>` in there is not chrome the editor added
 * around the content; it IS the content, written by the person exporting. The
 * blanket "remove every control" rule in `stripEditingChrome` is right for
 * everything the editor put on the page and wrong for everything the author put
 * in it, and this is where that line falls.
 *
 * The block's own chrome — its `html-block-textarea`, its header — sits OUTSIDE
 * `.html-block-render`, so it is still removed.
 *
 * ‼️ ONE predicate for every export pass that must tell the document from the
 * editor — the two code-block loops in `export-html.ts` (they stay index-aligned
 * only by filtering with the SAME predicate, `isOrdinaryCodeBlock`, which builds
 * on this one), `stripEditingChrome` and `linkInternalReferences` (which take it
 * as a parameter), the settle loop's plugin branch (`pluginBlockSettled` in
 * `export-heavy-blocks.ts` — its code, math and mermaid branches do not filter
 * authored markup) and the plugin-block pass (§394). It lives in this leaf so
 * none of them imports the orchestrator `export-html.ts` (plan 0125 P19).
 */
export function isAuthoredMarkup(el: Element): boolean {
  return el.closest(".html-block-render") !== null;
}
