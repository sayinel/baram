// §394 spec 0073 D12 — the attribute that marks a plugin-rendered code block's root
// (`rendered-code-block-view.ts`). Export pairs those roots with the live blocks, and settle waits
// on them, by this mark — so it is an APP marker, never document content. DOMPurify keeps `data-*`,
// so the document sanitizers (`sanitizeHtmlBlock`, `sanitizeSvg`) forbid it next to the vim island
// markers; the export's `isAuthoredMarkup` filter stays behind them as a second layer. A leaf that
// imports nothing, like `vim-island-markers.ts`, so a sanitizer does not import the view.

/** Marks a plugin-rendered code block's root. */
export const PLUGIN_BLOCK_MARKER = "data-plugin-block";
