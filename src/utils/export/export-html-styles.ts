// §5.12 HTML Export — CSS/style constants

export const MONO_FONT =
  '"JetBrains Mono","Fira Code","SF Mono",ui-monospace,monospace';

/** Style presets per code block data-style variant */
export const CODE_STYLE_MAP: Record<
  string,
  {
    bodyBg: string;
    bodyBorder: string;
    bodyColor: string;
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
    gutterColor: "#9ca3af",
    gutterBorder: "#e5e7eb",
  },
  contrast: {
    langBg: "#1e1e2e",
    langBorder: "#313244",
    langColor: "#a6adc8",
    bodyBg: "#1e1e2e",
    bodyBorder: "#313244",
    bodyColor: "#cdd6f4",
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
    gutterColor: "#9ca3af",
    gutterBorder: "transparent",
  },
};

/** Editor typography CSS — extracted from styles/editor.css .tiptap rules */
export const EDITOR_CSS = `
/* Base */
body {
  margin: 0;
  padding: 0;
  font-family: "Pretendard", "Inter", -apple-system, system-ui, sans-serif;
  font-size: 1rem;
  line-height: 1.75;
  color: #1a1a1a;
  background: #ffffff;
  -webkit-font-smoothing: antialiased;
}

article.baram-export {
  max-width: 720px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
  overflow-wrap: break-word;
  word-wrap: break-word;
}

/* Headings */
h1 { font-size: 2em; font-weight: 700; line-height: 1.2; margin: 1.4em 0 0.6em; }
h2 { font-size: 1.5em; font-weight: 700; line-height: 1.3; margin: 1.2em 0 0.5em; }
h3 { font-size: 1.25em; font-weight: 600; line-height: 1.4; margin: 1em 0 0.4em; }
h4 { font-size: 1.1em; font-weight: 600; line-height: 1.4; margin: 0.8em 0 0.3em; }
h5 { font-size: 1em; font-weight: 600; line-height: 1.5; margin: 0.6em 0 0.25em; }
h6 { font-size: 0.9em; font-weight: 600; line-height: 1.5; margin: 0.5em 0 0.2em; color: #6b7280; }
h1:first-child, h2:first-child, h3:first-child,
h4:first-child, h5:first-child, h6:first-child { margin-top: 0; }

/* Paragraph */
p { margin: 0.5em 0; }

/* Blockquote */
blockquote {
  border-left: 3px solid #e5e7eb;
  padding-left: 1em;
  margin: 0.5em 0;
  color: #6b7280;
}
blockquote p { margin: 0.25em 0; }

/* Lists */
ul { list-style-type: disc; padding-left: 1.6em; margin: 0.5em 0; }
ol { list-style-type: decimal; padding-left: 1.6em; margin: 0.5em 0; }
li { margin: 0.15em 0; padding-left: 0.2em; }
li p { margin: 0; }
ul ul, ol ul { list-style-type: circle; }
ul ul ul, ol ul ul { list-style-type: square; }

/* Task List */
ul[data-type="taskList"] { list-style: none; padding-left: 0; }
ul[data-type="taskList"] li[data-type="taskItem"] {
  display: flex; align-items: baseline; gap: 0.4em;
}
ul[data-type="taskList"] li[data-type="taskItem"] > label {
  flex-shrink: 0; display: flex; align-items: center; height: 1.75em; user-select: none;
}
ul[data-type="taskList"] li[data-type="taskItem"] > label input[type="checkbox"] {
  accent-color: #3b82f6; margin: 0; width: 14px; height: 14px;
}
ul[data-type="taskList"] li[data-type="taskItem"] > div { flex: 1; min-width: 0; }
ul[data-type="taskList"] li[data-type="taskItem"][data-checked="true"] > div {
  text-decoration: line-through; color: #9ca3af;
}

/* Horizontal Rule */
hr { border: none; border-top: 2px solid #e5e7eb; margin: 1.5em 0; }

/* Inline code */
code {
  font-family: "JetBrains Mono", "Fira Code", "SF Mono", ui-monospace, monospace;
  font-size: 0.875em;
  background-color: #f8f9fa;
  border: 1px solid #f3f4f6;
  border-radius: 3px;
  padding: 0.1em 0.3em;
}

/* Code Block — basic pre/code (fallback for blocks without CodeMirror) */
pre {
  background-color: #f8f9fa;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 0.75em 1em;
  margin: 1em 0;
  overflow-x: auto;
}
pre code {
  font-family: "JetBrains Mono", "Fira Code", "SF Mono", ui-monospace, monospace;
  font-size: 0.875em;
  line-height: 1.6;
  background: none;
  padding: 0;
  border: none;
  color: inherit;
}

/* Code Block — styled export wrapper */
.code-block-export {
  margin: 1em 0;
  overflow: hidden;
}
.code-block-export-lang {
  font-family: "JetBrains Mono", "Fira Code", "SF Mono", ui-monospace, monospace;
  font-size: 0.7rem;
  padding: 2px 8px;
  background-color: #f0f1f3;
  border: 1px solid #e5e7eb;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  color: #6b7280;
}
.code-block-body {
  display: flex;
  font-family: "JetBrains Mono", "Fira Code", "SF Mono", ui-monospace, monospace;
  font-size: 0.875em;
  line-height: 1.6;
  background-color: #f8f9fa;
  border: 1px solid #e5e7eb;
  border-radius: 0 0 6px 6px;
  overflow-x: auto;
}
.code-block-export-lang + .code-block-body {
  border-top: none;
}
.code-block-export:not(:has(.code-block-export-lang)) .code-block-body {
  border-radius: 6px;
}
.code-block-gutter {
  flex-shrink: 0;
  margin: 0;
  padding: 0.75em 0.75em 0.75em 0.75em;
  color: #9ca3af;
  text-align: right;
  border-right: 1px solid #e5e7eb;
  background: inherit;
  user-select: none;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  border-radius: 0;
  border: none;
}
.code-block-code {
  flex: 1;
  margin: 0;
  padding: 0.75em 1em;
  border: none;
  border-radius: 0;
  background: none;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  overflow-x: visible;
}
.code-block-code code {
  background: none;
  border: none;
  padding: 0;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  color: inherit;
}

/* Code Block Style: Minimal */
.code-block-export[data-style="minimal"] .code-block-export-lang {
  background: transparent;
  border: none;
  padding: 2px 4px;
}
.code-block-export[data-style="minimal"] .code-block-body {
  background: transparent;
  border: none;
  border-bottom: 1px solid #e5e7eb;
  border-radius: 0;
}
.code-block-export[data-style="minimal"] .code-block-gutter {
  border-right-color: #e5e7eb;
}

/* Code Block Style: Contrast — dark background */
.code-block-export[data-style="contrast"] .code-block-export-lang {
  background-color: #1e1e2e;
  border-color: #313244;
  color: #a6adc8;
}
.code-block-export[data-style="contrast"] .code-block-body {
  background-color: #1e1e2e;
  border-color: #313244;
  color: #cdd6f4;
}
.code-block-export[data-style="contrast"] .code-block-gutter {
  color: #6c7086;
  border-right-color: #313244;
}

/* Code Block Style: Paper */
.code-block-export[data-style="paper"] .code-block-export-lang {
  background-color: #f0f1f3;
  border: none;
  border-radius: 4px 4px 0 0;
  font-size: 0.65rem;
}
.code-block-export[data-style="paper"] .code-block-body {
  background-color: #f0f1f3;
  border: none;
  border-radius: 6px;
}
.code-block-export[data-style="paper"] .code-block-gutter {
  border-right: none;
  color: #9ca3af;
}

/* Table */
.tableWrapper { overflow-x: auto; margin: 1em 0; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
.tableWrapper table { margin: 0; }
th, td { border: 1px solid #d1d5db; padding: 0.4em 0.75em; min-width: 60px; vertical-align: top; }
th { font-weight: 600; background-color: #f3f4f6; }
th p, td p { margin: 0; }

/* Inline marks */
strong { font-weight: 700; }
em { font-style: italic; }
del { text-decoration: line-through; }
a { color: #3b82f6; text-decoration: underline; text-underline-offset: 2px; }
mark { background-color: #fef08a; padding: 0 2px; border-radius: 2px; }
sub { font-size: 0.75em; }
sup { font-size: 0.75em; }

/* Math blocks */
.math-block { margin: 1em 0; }
.math-block-row { display: flex; align-items: center; }
.math-block-katex { flex: 1; text-align: center; padding: 0.5em 0; overflow-x: auto; }
.math-block-eq-number { flex-shrink: 0; font-size: 0.95em; color: #6b7280; padding-right: 0.25em; }

/* Inline math */
.math-inline { display: inline; }

/* Mermaid blocks — small diagrams keep natural size, large ones cap at text width */
.mermaid-block { margin: 1em 0; text-align: center; }
.mermaid-block-svg { display: inline-block; max-width: 100%; }
.mermaid-block-svg svg { max-width: 100%; height: auto; }

/* Frontmatter */
.frontmatter {
  background-color: #f8f9fa;
  border: 1px dashed #e5e7eb;
  border-radius: 6px;
  padding: 0.5em 1em;
  margin-bottom: 1em;
}
.frontmatter pre { background: none; border: none; padding: 0; margin: 0; }
.frontmatter pre code {
  font-size: 0.8em; color: #6b7280; background: none; border: none; padding: 0;
}

/* Image */
img { max-width: 100%; height: auto; border-radius: 4px; }
.image-node-view { margin: 0.5em 0; }
.image-figure { display: inline-block; max-width: 100%; }
figure { margin: 1em 0; text-align: center; }
figcaption { font-size: 0.85em; color: #6b7280; margin-top: 0.25em; text-align: center; }

/* Callout */
.callout { border-left: 3px solid #3b82f6; padding: 0.5em 1em; margin: 0.5em 0; background: #eff6ff; border-radius: 0 6px 6px 0; }

/* Definition list */
dl { margin: 0.5em 0; }
dt { font-weight: 600; margin-top: 0.5em; }
dt:first-child { margin-top: 0; }
dd { margin-left: 1.5em; margin-top: 0.15em; padding-left: 0.5em; border-left: 2px solid #e5e7eb; color: #6b7280; }

/* Toggle / Details */
details { margin: 0.5em 0; }
details summary { cursor: pointer; font-weight: 600; }

/* Tag nodes */
.tag-node { color: #3b82f6; font-weight: 500; }

/* Wikilink */
.wikilink-node { color: #3b82f6; }

/* Block reference */
.block-reference {
  color: #7c3aed;
  background-color: rgba(124, 58, 237, 0.08);
  border-radius: 4px;
  padding: 0 4px;
  font-size: 0.9em;
  border: 1px solid rgba(124, 58, 237, 0.25);
}

/* Block embed */
.block-embed {
  border: 1px solid #e5e7eb;
  border-left: 3px solid #7c3aed;
  border-radius: 6px;
  margin: 8px 0;
  overflow: hidden;
}
.block-embed-header {
  padding: 6px 12px;
  font-size: 0.75rem;
  color: #7c3aed;
  background: rgba(124, 58, 237, 0.05);
  border-bottom: 1px solid #e5e7eb;
}
.block-embed-content {
  padding: 8px 12px;
  font-size: 0.9rem;
  white-space: pre-wrap;
}

/* Footnote reference — inline superscript */
.footnote-ref {
  color: #3b82f6;
  font-size: 0.75em;
  vertical-align: super;
  line-height: 0;
  font-weight: 600;
  padding: 0 1px;
}

/* Footnote definition — inline N. content ↩ layout */
.footnote-definition {
  display: flex;
  align-items: baseline;
  border-top: 1px solid #e5e7eb;
  margin: 1em 0 0.5em;
  padding: 0.5em 0 0.25em;
  gap: 4px;
}
.footnote-definition-label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #3b82f6;
  flex-shrink: 0;
  white-space: nowrap;
}
.footnote-definition-body {
  flex: 1;
  min-width: 0;
}
.footnote-definition-body p {
  margin: 0;
}
.footnote-definition-back {
  background: none;
  border: none;
  font-size: 0.85rem;
  color: #6b7280;
  padding: 0 2px;
  margin-left: auto;
  flex-shrink: 0;
}
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
  pre, blockquote, table, img, .math-block, .mermaid-block, .code-block-export { page-break-inside: avoid; }
  table { max-width: 100%; }
  .tableWrapper { overflow: hidden; }
  a { color: #3b82f6; }
  .mermaid-hover-toolbar, .mermaid-context-menu { display: none !important; }
  /* Scale tall diagrams down so a single mermaid never spans pages.
     In print, vh maps to the page box; combined with the intrinsic aspect
     ratio (width/height attrs set during export capture), width/height:auto
     fit the diagram within both the text column and one page, preserving ratio. */
  .mermaid-block-svg svg {
    width: auto !important;
    height: auto !important;
    max-width: 100% !important;
    max-height: 90vh !important;
  }
}
`;
