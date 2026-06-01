import type { CodeBlockInfo } from "./export-html-code-block";
// §5.12 HTML Export — Standalone HTML document generator
import type { Editor } from "@tiptap/core";

import katexCSS from "katex/dist/katex.min.css?raw";

import {
  buildCodeBlockExport,
  collectCodeBlockInfo,
  escapeHTML,
} from "./export-html-code-block";
import { EDITOR_CSS, PRINT_CSS } from "./export-html-styles";

export interface ExportHTMLOptions {
  theme?: "dark" | "light";
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
  for (const el of clone.querySelectorAll(".mermaid-block-textarea"))
    el.remove();
  for (const el of clone.querySelectorAll(".mermaid-block-error")) el.remove();
  for (const el of clone.querySelectorAll(".mermaid-block-empty")) el.remove();
  for (const el of clone.querySelectorAll(".mermaid-context-menu")) el.remove();
  for (const el of clone.querySelectorAll(".mermaid-hover-toolbar"))
    el.remove();
  for (const el of clone.querySelectorAll(".mermaid-template-wrapper"))
    el.remove();
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
  for (const el of clone.querySelectorAll(".ProseMirror-gapcursor"))
    el.remove();
  for (const el of clone.querySelectorAll(".ProseMirror-separator"))
    el.remove();
  for (const el of clone.querySelectorAll(".ProseMirror-trailingBreak"))
    el.remove();
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

  // ── Table: remove selection classes, resize handles, add inline styles ──
  for (const el of clone.querySelectorAll(".selectedCell")) {
    el.classList.remove("selectedCell");
  }
  for (const el of clone.querySelectorAll(".column-resize-handle")) {
    el.remove();
  }
  // Apply inline styles to th/td for reliable PDF rendering
  for (const th of clone.querySelectorAll("th")) {
    (th as HTMLElement).style.cssText +=
      ";font-weight:600;background-color:#f3f4f6;border:1px solid #d1d5db;padding:0.4em 0.75em;";
  }
  for (const td of clone.querySelectorAll("td")) {
    (td as HTMLElement).style.cssText +=
      ";border:1px solid #d1d5db;padding:0.4em 0.75em;";
  }
  for (const table of clone.querySelectorAll("table")) {
    (table as HTMLElement).style.cssText +=
      ";border-collapse:collapse;width:100%;";
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
