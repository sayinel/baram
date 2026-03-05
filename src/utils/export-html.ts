// §5.12 HTML Export — Standalone HTML document generator
import type { Editor } from "@tiptap/core";
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

/* Code Block */
pre {
  background-color: #f8f9fa;
  border: 1px solid #f3f4f6;
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
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
th, td { border: 1px solid #e5e7eb; padding: 0.4em 0.75em; min-width: 60px; vertical-align: top; }
th { font-weight: 600; background-color: #f8f9fa; }
th p, td p { margin: 0; }

/* Inline marks */
strong { font-weight: 700; }
em { font-style: italic; }
del { text-decoration: line-through; }
a { color: #3b82f6; text-decoration: underline; text-underline-offset: 2px; }

/* Math blocks */
.math-block { margin: 1em 0; }
.math-block-row { display: flex; align-items: center; }
.math-block-katex { flex: 1; text-align: center; padding: 0.5em 0; overflow-x: auto; }
.math-block-eq-number { flex-shrink: 0; font-size: 0.95em; color: #6b7280; padding-right: 0.25em; }

/* Inline math */
.math-inline { display: inline; }

/* Mermaid blocks */
.mermaid-block { margin: 1em 0; text-align: center; }
.mermaid-block-svg { display: inline-block; }
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
figure { margin: 1em 0; text-align: center; }
figcaption { font-size: 0.9em; color: #6b7280; margin-top: 0.25em; }

/* Callout */
.callout { border-left: 3px solid #3b82f6; padding: 0.5em 1em; margin: 0.5em 0; background: #eff6ff; border-radius: 0 6px 6px 0; }

/* Definition list */
dl { margin: 0.5em 0; }
dt { font-weight: 600; margin-top: 0.5em; }
dd { margin-left: 1.5em; margin-top: 0.15em; }

/* Toggle / Details */
details { margin: 0.5em 0; }
details summary { cursor: pointer; font-weight: 600; }

/* Tag nodes */
.tag-node { color: #3b82f6; font-weight: 500; }

/* Wikilink */
.wikilink-node { color: #3b82f6; }
`;

/** Print-specific CSS */
const PRINT_CSS = `
@media print {
  body { background: white; }
  article.baram-export { max-width: none; padding: 0; margin: 0; }
  h1, h2, h3, h4, h5, h6 { page-break-after: avoid; }
  pre, blockquote, table, img, .math-block, .mermaid-block { page-break-inside: avoid; }
  a { color: #1a1a1a; text-decoration: none; }
  a[href]::after { content: " (" attr(href) ")"; font-size: 0.8em; color: #6b7280; }
}
`;

export interface ExportHTMLOptions {
  theme?: "light" | "dark";
}

/**
 * Capture the editor's live DOM (with rendered KaTeX, Mermaid SVG, images)
 * and return a cleaned HTML string suitable for export.
 *
 * Unlike editor.getHTML() which uses renderHTML() (producing empty divs for
 * NodeView-based nodes), this captures the actual rendered content including
 * KaTeX math, Mermaid SVGs, and properly resolved images.
 */
export function captureEditorHTML(editor: Editor): string {
  const dom = editor.view.dom;
  const clone = dom.cloneNode(true) as HTMLElement;

  // ── Math blocks: keep rendered KaTeX, remove editing UI ──────────
  for (const el of clone.querySelectorAll(".math-block-textarea")) el.remove();
  for (const el of clone.querySelectorAll(".math-block-error")) el.remove();
  for (const el of clone.querySelectorAll(".math-block-editing")) {
    el.classList.remove("math-block-editing");
    el.classList.add("math-block-preview");
  }

  // ── Mermaid blocks: keep rendered SVG, remove editing UI ─────────
  for (const el of clone.querySelectorAll(".mermaid-block-textarea")) el.remove();
  for (const el of clone.querySelectorAll(".mermaid-block-error")) el.remove();
  for (const el of clone.querySelectorAll(".mermaid-block-empty")) el.remove();
  for (const el of clone.querySelectorAll(".mermaid-context-menu")) el.remove();
  for (const el of clone.querySelectorAll(".mermaid-template-wrapper")) el.remove();
  for (const el of clone.querySelectorAll(".mermaid-block-label")) el.remove();
  for (const el of clone.querySelectorAll(".mermaid-block-editing")) {
    el.classList.remove("mermaid-block-editing");
    el.classList.add("mermaid-block-preview");
  }

  // ── Images: convert Tauri asset:// URLs to file:// for headless Chrome ──
  for (const img of clone.querySelectorAll("img")) {
    const src = img.getAttribute("src") || "";
    // Tauri 2.0 convertFileSrc() → http://asset.localhost/path or https://asset.localhost/path
    if (src.startsWith("http://asset.localhost/")) {
      img.setAttribute("src", "file://" + src.slice("http://asset.localhost".length));
    } else if (src.startsWith("https://asset.localhost/")) {
      img.setAttribute("src", "file://" + src.slice("https://asset.localhost".length));
    } else if (src.startsWith("asset://localhost/")) {
      img.setAttribute("src", "file://" + src.slice("asset://localhost".length));
    }
  }

  // ── Image toolbar / resize handles ───────────────────────────────
  for (const el of clone.querySelectorAll(".image-toolbar")) el.remove();
  for (const el of clone.querySelectorAll(".image-resize-handle")) el.remove();
  for (const el of clone.querySelectorAll(".image-caption input")) {
    // Convert caption input to plain text
    const text = (el as HTMLInputElement).value;
    if (text) {
      const span = document.createElement("span");
      span.textContent = text;
      el.replaceWith(span);
    } else {
      el.remove();
    }
  }

  // ── Code blocks: extract text from CodeMirror, replace with clean <pre><code> ──
  for (const cmWrapper of clone.querySelectorAll("[data-node-view-wrapper]")) {
    const cmEditor = cmWrapper.querySelector(".cm-editor");
    if (!cmEditor) continue;

    // Extract code text from CodeMirror line elements
    const lines: string[] = [];
    for (const line of cmEditor.querySelectorAll(".cm-line")) {
      lines.push(line.textContent || "");
    }
    if (lines.length === 0) continue;

    // Get language from data attribute
    const lang = cmWrapper.getAttribute("data-language") ||
                 cmWrapper.querySelector("[data-language]")?.getAttribute("data-language") || "";

    const pre = document.createElement("pre");
    const code = document.createElement("code");
    if (lang) code.className = `language-${lang}`;
    code.textContent = lines.join("\n");
    pre.appendChild(code);
    cmWrapper.replaceWith(pre);
  }

  // ── Block ID decorations ─────────────────────────────────────────
  for (const el of clone.querySelectorAll(".block-id-hint")) el.remove();
  for (const el of clone.querySelectorAll(".block-id-focused")) el.remove();
  for (const el of clone.querySelectorAll(".block-id-editing")) el.remove();

  // ── ProseMirror editing artifacts ────────────────────────────────
  for (const el of clone.querySelectorAll(".ProseMirror-gapcursor")) el.remove();
  for (const el of clone.querySelectorAll(".ProseMirror-separator")) el.remove();
  for (const el of clone.querySelectorAll(".ProseMirror-trailingBreak")) el.remove();
  for (const el of clone.querySelectorAll(".ProseMirror-selectednode")) {
    el.classList.remove("ProseMirror-selectednode");
  }

  // ── Block handle ─────────────────────────────────────────────────
  for (const el of clone.querySelectorAll(".block-handle-wrapper")) el.remove();

  // ── Find/Replace highlights ──────────────────────────────────────
  for (const el of clone.querySelectorAll(".search-result")) {
    el.classList.remove("search-result");
  }
  for (const el of clone.querySelectorAll(".search-result-active")) {
    el.classList.remove("search-result-active");
  }

  // ── Ghost text ───────────────────────────────────────────────────
  for (const el of clone.querySelectorAll(".ghost-text")) el.remove();

  // ── List atom fix widget ─────────────────────────────────────────
  for (const el of clone.querySelectorAll(".list-atom-fix")) el.remove();

  // ── Remove contenteditable attributes ────────────────────────────
  clone.removeAttribute("contenteditable");
  for (const el of clone.querySelectorAll("[contenteditable]")) {
    el.removeAttribute("contenteditable");
  }

  // ── Remove draggable attributes ──────────────────────────────────
  for (const el of clone.querySelectorAll("[draggable]")) {
    el.removeAttribute("draggable");
  }

  // ── Remove data-node-view-wrapper wrappers (unwrap content) ──────
  // Skip for math/mermaid/image which need their wrapper classes
  for (const wrapper of clone.querySelectorAll("[data-node-view-wrapper]")) {
    // If it's a recognized block with useful content, keep it
    if (
      wrapper.classList.contains("math-block") ||
      wrapper.classList.contains("mermaid-block") ||
      wrapper.classList.contains("image-node-view")
    ) {
      wrapper.removeAttribute("data-node-view-wrapper");
      wrapper.removeAttribute("style"); // Remove inline styles from NodeViewWrapper
      continue;
    }
    // For other NodeView wrappers, unwrap their children
    wrapper.removeAttribute("data-node-view-wrapper");
    wrapper.removeAttribute("style");
  }

  return clone.innerHTML;
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
