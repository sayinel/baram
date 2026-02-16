// §5.12 HTML Export — Standalone HTML document generator
import katexCSS from "katex/dist/katex.min.css?raw";

/** Escape HTML special characters in title */
function escapeHTML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Editor typography CSS — extracted from App.css .tiptap rules */
const EDITOR_CSS = `
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
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem 3rem;
}

/* Headings */
h1 { font-size: 2em; font-weight: 700; line-height: 1.2; margin: 1em 0 0.5em; }
h2 { font-size: 1.5em; font-weight: 700; line-height: 1.3; margin: 0.8em 0 0.4em; }
h3 { font-size: 1.25em; font-weight: 600; line-height: 1.4; margin: 0.6em 0 0.3em; }
h4 { font-size: 1.1em; font-weight: 600; line-height: 1.4; margin: 0.5em 0 0.25em; }
h5 { font-size: 1em; font-weight: 600; line-height: 1.5; margin: 0.4em 0 0.2em; }
h6 { font-size: 0.9em; font-weight: 600; line-height: 1.5; margin: 0.4em 0 0.2em; color: #6b7280; }
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

/* Code Block */
pre {
  background-color: #f8f9fa;
  border: 1px solid #f3f4f6;
  border-radius: 6px;
  padding: 0.75em 1em;
  margin: 0.5em 0;
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

/* Inline code */
code {
  font-family: "JetBrains Mono", "Fira Code", "SF Mono", ui-monospace, monospace;
  font-size: 0.875em;
  background-color: #f8f9fa;
  border: 1px solid #f3f4f6;
  border-radius: 3px;
  padding: 0.1em 0.3em;
}

/* Table */
table { border-collapse: collapse; width: 100%; margin: 0.5em 0; }
th, td { border: 1px solid #e5e7eb; padding: 0.4em 0.75em; min-width: 60px; vertical-align: top; }
th { font-weight: 600; background-color: #f8f9fa; }
th p, td p { margin: 0; }

/* Inline marks */
strong { font-weight: 700; }
em { font-style: italic; }
del { text-decoration: line-through; }
a { color: #3b82f6; text-decoration: underline; text-underline-offset: 2px; }

/* Math blocks */
.math-block { margin: 0.5em 0; }
.math-block-row { display: flex; align-items: center; }
.math-block-katex { flex: 1; text-align: center; padding: 0.5em 0; overflow-x: auto; }
.math-block-eq-number { flex-shrink: 0; font-size: 0.95em; color: #6b7280; padding-right: 0.25em; }

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
`;

/** Print-specific CSS */
const PRINT_CSS = `
@media print {
  body { background: white; }
  article.baram-export { max-width: none; padding: 0; margin: 0; }
  h1, h2, h3, h4, h5, h6 { page-break-after: avoid; }
  pre, blockquote, table, img { page-break-inside: avoid; }
  a { color: #1a1a1a; text-decoration: none; }
  a[href]::after { content: " (" attr(href) ")"; font-size: 0.8em; color: #6b7280; }
}
`;

export interface ExportHTMLOptions {
  theme?: "light" | "dark";
}

/**
 * Generate a standalone HTML document from editor HTML output.
 * Includes inline CSS for typography, KaTeX math, and print layout.
 */
export function generateStandaloneHTML(
  editorHTML: string,
  title: string,
  options?: ExportHTMLOptions,
): string {
  const safeTitle = escapeHTML(title);
  void options?.theme; // reserved for future dark theme export

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="generator" content="Baram">
  <title>${safeTitle}</title>
  <style>${katexCSS}</style>
  <style>${EDITOR_CSS}</style>
  <style>${PRINT_CSS}</style>
</head>
<body>
  <article class="baram-export">${editorHTML}</article>
</body>
</html>`;
}
