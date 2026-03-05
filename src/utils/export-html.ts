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

/** Escape HTML special characters in code text content */
function escapeCodeHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Convert an image URL to a base64 data URI */
async function imageToDataURI(src: string): Promise<string> {
  try {
    const response = await fetch(src);
    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return src; // fallback to original URL
  }
}

/**
 * Extract highlighted HTML from a CodeMirror .cm-line element,
 * reading computed styles from the live DOM to produce inline styles.
 */
function extractHighlightedLineHTML(lineEl: HTMLElement): string {
  let html = "";
  for (const child of lineEl.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      html += escapeCodeHTML(child.textContent || "");
    } else if (child instanceof HTMLElement) {
      if (child.tagName === "BR") continue;
      // Skip CM editing widgets
      if (
        child.classList.contains("cm-widgetBuffer") ||
        child.classList.contains("cm-cursor") ||
        child.classList.contains("cm-selectionLayer") ||
        child.classList.contains("cm-placeholder")
      ) continue;
      const text = escapeCodeHTML(child.textContent || "");
      if (!text) continue;

      // Read computed style from live DOM
      const computed = getComputedStyle(child);
      const parts: string[] = [];
      if (computed.color) parts.push(`color:${computed.color}`);
      if (computed.fontWeight === "bold" || computed.fontWeight === "700") {
        parts.push("font-weight:bold");
      }
      if (computed.fontStyle === "italic") parts.push("font-style:italic");
      if (computed.textDecoration.includes("underline")) {
        parts.push("text-decoration:underline");
      }

      if (parts.length > 0) {
        html += `<span style="${parts.join(";")}">${text}</span>`;
      } else {
        html += text;
      }
    }
  }
  return html;
}

interface CodeBlockInfo {
  lang: string;
  style: string;
  lineNumbers: string[] | null;
  highlightedLines: string[];
}

/** Collect code block data from the live DOM (before cloning) */
function collectCodeBlockInfo(wrapper: Element): CodeBlockInfo {
  const cmEditor = wrapper.querySelector(".cm-editor");
  if (!cmEditor)
    return { lang: "", style: "default", lineNumbers: null, highlightedLines: [] };

  const lang =
    wrapper.getAttribute("data-language") ||
    (wrapper.querySelector(".code-block-lang-select") as HTMLSelectElement)
      ?.value ||
    "";
  const style = wrapper.getAttribute("data-style") || "default";

  // Line numbers from gutter (if present)
  const gutterEls = cmEditor.querySelectorAll(
    ".cm-lineNumbers .cm-gutterElement",
  );
  let lineNumbers: string[] | null = null;
  if (gutterEls.length > 0) {
    lineNumbers = [];
    for (const el of gutterEls) {
      const text = el.textContent?.trim() || "";
      // Skip spacer elements (empty or height: 0)
      if (text && text !== "\u200B") lineNumbers.push(text);
    }
  }

  // Highlighted lines with computed inline styles
  const highlightedLines: string[] = [];
  for (const lineEl of cmEditor.querySelectorAll(".cm-content .cm-line")) {
    highlightedLines.push(extractHighlightedLineHTML(lineEl as HTMLElement));
  }

  return { lang, style, lineNumbers, highlightedLines };
}

/** Build export DOM for a code block */
function buildCodeBlockExport(info: CodeBlockInfo): HTMLElement {
  const exportDiv = document.createElement("div");
  exportDiv.className = "code-block-export";
  exportDiv.setAttribute("data-style", info.style);

  // Language label
  if (info.lang) {
    const langLabel = document.createElement("div");
    langLabel.className = "code-block-export-lang";
    langLabel.textContent = info.lang;
    exportDiv.appendChild(langLabel);
  }

  const body = document.createElement("div");
  body.className = "code-block-body";

  // Line numbers gutter (if present)
  if (info.lineNumbers && info.lineNumbers.length > 0) {
    const gutter = document.createElement("pre");
    gutter.className = "code-block-gutter";
    gutter.textContent = info.lineNumbers.join("\n");
    body.appendChild(gutter);
  }

  // Code content with highlighted spans
  const pre = document.createElement("pre");
  pre.className = "code-block-code";
  const code = document.createElement("code");
  if (info.lang) code.className = `language-${info.lang}`;
  code.innerHTML = info.highlightedLines.join("\n");
  pre.appendChild(code);
  body.appendChild(pre);

  exportDiv.appendChild(body);
  return exportDiv;
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
const PRINT_CSS = `
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
 *
 * For code blocks, reads computed styles from the live DOM BEFORE cloning
 * to preserve syntax highlighting as inline styles.
 */
export async function captureEditorHTML(editor: Editor): Promise<string> {
  const dom = editor.view.dom;

  // ── Collect code block data from live DOM (before cloning) ────────
  // getComputedStyle() only works on elements in the live DOM
  const codeBlockInfos: CodeBlockInfo[] = [];
  for (const wrapper of dom.querySelectorAll(".code-block-wrapper")) {
    codeBlockInfos.push(collectCodeBlockInfo(wrapper));
  }

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

  // ── Images: convert Tauri asset URLs to base64 data URIs ──────────
  const imgPromises: Promise<void>[] = [];
  for (const img of clone.querySelectorAll("img")) {
    const src = img.getAttribute("src") || "";
    if (
      src.startsWith("http://asset.localhost/") ||
      src.startsWith("https://asset.localhost/") ||
      src.startsWith("asset://localhost/")
    ) {
      const originalImg = dom.querySelector(
        `img[src="${CSS.escape(src)}"]`,
      ) as HTMLImageElement | null;
      const fetchUrl = originalImg?.src || src;
      imgPromises.push(
        imageToDataURI(fetchUrl).then((dataUri) => {
          img.setAttribute("src", dataUri);
        }),
      );
    }
  }
  await Promise.all(imgPromises);

  // ── Image toolbar / resize handles ───────────────────────────────
  for (const el of clone.querySelectorAll(".image-toolbar")) el.remove();
  for (const el of clone.querySelectorAll(".image-resize-handle")) el.remove();
  for (const el of clone.querySelectorAll(".image-caption input")) {
    const text = (el as HTMLInputElement).value;
    if (text) {
      const span = document.createElement("span");
      span.textContent = text;
      el.replaceWith(span);
    } else {
      el.remove();
    }
  }
  for (const el of clone.querySelectorAll(".image-caption-placeholder")) {
    if (!(el as HTMLElement).textContent?.trim()) el.remove();
  }

  // ── Code blocks: replace with pre-collected highlighted HTML ──────
  const cloneCodeBlocks = clone.querySelectorAll(".code-block-wrapper");
  cloneCodeBlocks.forEach((wrapper, i) => {
    const info = codeBlockInfos[i];
    if (!info || info.highlightedLines.length === 0) return;
    const exportEl = buildCodeBlockExport(info);
    wrapper.replaceWith(exportEl);
  });

  // ── Block embeds: remove editing UI, keep preview ─────────────────
  for (const el of clone.querySelectorAll(".block-embed-textarea")) el.remove();
  for (const el of clone.querySelectorAll(".block-embed-editing")) {
    el.classList.remove("block-embed-editing");
  }
  for (const el of clone.querySelectorAll(".block-embed-selected")) {
    el.classList.remove("block-embed-selected");
  }

  // ── Block references: remove selection state ──────────────────────
  for (const el of clone.querySelectorAll(".block-reference-selected")) {
    el.classList.remove("block-reference-selected");
  }

  // ── Footnotes: remove tooltip and clean up ────────────────────────
  for (const el of clone.querySelectorAll(".footnote-ref-tooltip")) el.remove();
  for (const el of clone.querySelectorAll(".footnote-ref-selected")) {
    el.classList.remove("footnote-ref-selected");
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

  // ── Table: remove selection classes and resize handles ─────────────
  for (const el of clone.querySelectorAll(".selectedCell")) {
    el.classList.remove("selectedCell");
  }
  for (const el of clone.querySelectorAll(".column-resize-handle")) {
    el.remove();
  }

  // ── Remove contenteditable attributes ────────────────────────────
  clone.removeAttribute("contenteditable");
  for (const el of clone.querySelectorAll("[contenteditable]")) {
    el.removeAttribute("contenteditable");
  }

  // ── Remove draggable attributes ──────────────────────────────────
  for (const el of clone.querySelectorAll("[draggable]")) {
    el.removeAttribute("draggable");
  }

  // ── Remove data-node-view-wrapper wrappers ────────────────────────
  for (const wrapper of clone.querySelectorAll("[data-node-view-wrapper]")) {
    wrapper.removeAttribute("data-node-view-wrapper");
    wrapper.removeAttribute("data-node-view-content");
    // Keep inline styles on image-related elements (width %)
    if (
      !wrapper.classList.contains("image-figure") &&
      !wrapper.classList.contains("image-node-view")
    ) {
      wrapper.removeAttribute("style");
    }
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
