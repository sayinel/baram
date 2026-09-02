// §5.12 HTML Export — the stylesheet the exported document ships.
//
// The DOCUMENT's appearance is not written here: it is taken from the editor's
// own stylesheets and rescoped (export-editor-css.ts), so the two can no longer
// drift. What is written here is everything that exists only because the
// destination is a file rather than an editor — the page frame, the code block
// the export builds itself, the stand-ins for media that cannot play, and the
// print rules.

import { editorContentCSS, exportTokensCSS } from "./export-editor-css";

export const MONO_FONT =
  '"JetBrains Mono","Fira Code","SF Mono",ui-monospace,monospace';

/** Style presets per code block data-style variant */
export const CODE_STYLE_MAP: Record<
  string,
  {
    bodyBg: string;
    bodyBorder: string;
    bodyColor: string;
    /** gutter 배경 — "inherit"는 본문 배경을 그대로 쓴다. contrast만 mantle로 어둡다. */
    gutterBg: string;
    gutterBorder: string;
    gutterColor: string;
    langBg: string;
    langBorder: string;
    langColor: string;
  }
> = {
  default: {
    langBg: "#f0f1f3",
    langBorder: "#e5e7eb",
    langColor: "#6b7280",
    bodyBg: "#f8f9fa",
    bodyBorder: "#e5e7eb",
    bodyColor: "#1a1a1a",
    gutterBg: "inherit",
    gutterColor: "#9ca3af",
    gutterBorder: "#e5e7eb",
  },
  minimal: {
    langBg: "transparent",
    langBorder: "transparent",
    langColor: "#6b7280",
    bodyBg: "transparent",
    bodyBorder: "transparent",
    bodyColor: "#1a1a1a",
    gutterBg: "inherit",
    gutterColor: "#9ca3af",
    gutterBorder: "#e5e7eb",
  },
  // ‼️ 앱 쪽 contrast 팔레트의 사본 — styles/editor/code-blocks.css의
  // --code-contrast-* 컴포넌트 변수와 같은 Catppuccin Mocha 값이다.
  // 값을 바꾸면 거기도 같이 바꿀 것 (standalone export라 var()를 못 읽는다).
  contrast: {
    langBg: "#1e1e2e",
    langBorder: "#313244",
    langColor: "#a6adc8",
    bodyBg: "#1e1e2e",
    bodyBorder: "#313244",
    bodyColor: "#cdd6f4",
    gutterBg: "#181825",
    gutterColor: "#6c7086",
    gutterBorder: "#313244",
  },
  paper: {
    langBg: "#f0f1f3",
    langBorder: "transparent",
    langColor: "#6b7280",
    bodyBg: "#f0f1f3",
    bodyBorder: "transparent",
    bodyColor: "#1a1a1a",
    gutterBg: "inherit",
    gutterColor: "#9ca3af",
    gutterBorder: "transparent",
  },
};

/**
 * The page frame, and the few elements that exist only in an export.
 *
 * Everything here has no editor counterpart to inherit from. A rule that DOES
 * have one belongs in the editor's stylesheet, not in a second copy that will
 * quietly stop matching it.
 */
export const EXPORT_BASE_CSS = `
/* Page frame — the editor's own root rule is deliberately not reused: it sets a
   min-height, the user's configured font size and the editor padding, none of
   which describe a printed page. */
body {
  margin: 0;
  padding: 0;
  font-family: var(--font-family-editor);
  font-size: 1rem;
  line-height: 1.75;
  color: var(--color-editor-text);
  background: var(--color-editor-bg);
  -webkit-font-smoothing: antialiased;
}

article.baram-export {
  max-width: 720px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
  overflow-wrap: break-word;
  word-wrap: break-word;
}

/* The editor leaves these three to the UA stylesheet, so there is nothing to
   inherit and the export has to state them. */
article.baram-export mark { background-color: #fef08a; padding: 0 2px; border-radius: 2px; }
article.baram-export sub { font-size: 0.75em; }
article.baram-export sup { font-size: 0.75em; }

/* ‼️ Restated, not inherited: \`.tag-node\` lives in styles/journal-extras.css,
   a module that is otherwise entirely app chrome (calendars, note lists) and
   cannot be pulled into a document stylesheet. A tag IS document content, so
   the alternative to this small copy is tags printing as unstyled text. */
article.baram-export .tag-node { color: var(--color-accent-default); font-weight: 500; }

/* Code block — built by export-html-code-block.ts rather than cloned, because
   the live block is a CodeMirror instance full of editing machinery. The
   per-variant palette is applied inline there; these rules carry the rest. */
.code-block-export { margin: 1em 0; overflow: hidden; }
.code-block-export-lang {
  font-family: ${MONO_FONT};
  font-size: 0.7rem;
}
.code-block-body {
  display: flex;
  font-family: ${MONO_FONT};
  font-size: 0.875em;
  line-height: 1.6;
  overflow-x: auto;
}
.code-block-gutter {
  flex-shrink: 0;
  margin: 0;
  text-align: right;
  background: inherit;
  user-select: none;
  font: inherit;
  line-height: inherit;
}
.code-block-code { flex: 1; margin: 0; border: none; border-radius: 0; background: none; font: inherit; }
.code-block-code code {
  background: none; border: none; padding: 0;
  font: inherit; line-height: inherit; color: inherit;
}

/* An internal reference is retagged from <span>/<sup> to <a> so the PDF gets a
   link annotation (export-html.ts linkInternalReferences). It must still read
   as a chip or a superscript, not as a blue underlined link — and only the
   underline needs undoing: every one of these already paints
   var(--color-accent-default), which is the same colour the anchor rule would
   give it, so the two agree on everything but the decoration. */
article.baram-export a.block-reference,
article.baram-export a.footnote-ref,
article.baram-export a.footnote-definition-label { text-decoration: none; }

/* §301 media stand-ins. A PDF cannot play a video; a local file's relative href
   cannot resolve from the temp directory Chrome prints in. The link is for a
   remote source, the plain span for a local one — no colour and no underline on
   the latter, because it is not clickable and must not look like it is. */
.video-export-link { display: inline-block; max-width: 100%; overflow-wrap: anywhere; }
.video-export-path { display: inline-block; max-width: 100%; overflow-wrap: anywhere; }
`;

/** Print-specific CSS */
export const PRINT_CSS = `
@page {
  margin: 15mm;
}
@media print {
  body { background: white; }
  article.baram-export { max-width: none; padding: 0; margin: 0; }
  h1, h2, h3, h4, h5, h6 { page-break-after: avoid; }
  pre, blockquote, table, img, .math-block, .mermaid-block, .code-block-export,
  .callout { page-break-inside: avoid; }
  /* Belt and braces for the hover chrome captureEditorHTML already removes.
     ‼️ Named classes only, deliberately NOT a blanket button/select selector:
     an HTML block prints the author's own markup, and a button they wrote is
     content (see isAuthoredMarkup in export-html.ts). A rule here cannot tell
     the two apart, so it stays out of that judgement and leaves it to the one
     place that can. */
  .media-toolbar, .media-resize-handle, .media-resize-label,
  .mermaid-context-menu, .svg-context-menu { display: none !important; }
  /* Scale tall diagrams down so a single mermaid never spans pages.
     In print, vh maps to the page box; combined with the intrinsic aspect
     ratio (width/height attrs set during export capture), width/height:auto
     fit the diagram within both the text column and one page, preserving ratio. */
  .mermaid-block svg {
    width: auto !important;
    height: auto !important;
    max-width: 100% !important;
    max-height: 90vh !important;
  }
}
`;

/**
 * The complete stylesheet an exported document carries, in cascade order.
 *
 * Tokens first (everything below resolves `var()` against them), then the
 * editor's own appearance, then the export-only frame, then print. Exported as
 * one function so the tests can assert against exactly what ships rather than
 * against one of the pieces.
 */
export function buildExportStylesheet(): string {
  return [
    exportTokensCSS(),
    editorContentCSS(),
    EXPORT_BASE_CSS.trim(),
    PRINT_CSS.trim(),
  ].join("\n\n");
}
