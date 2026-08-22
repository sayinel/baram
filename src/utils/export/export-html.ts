import type { CodeBlockInfo } from "./export-html-code-block";
// §5.12 HTML Export — Standalone HTML document generator
import type { Editor } from "@tiptap/core";

import katexCSS from "katex/dist/katex.min.css?raw";

import { withVirtualizationSuspended } from "../../extensions/plugins/viewport-virtualize";
import { activeFileDir } from "../active-file-dir";
import { relativeToRoot } from "../path-utils";
import {
  buildCodeBlockExport,
  collectCodeBlockInfo,
  escapeHTML,
} from "./export-html-code-block";
import { EDITOR_CSS, PRINT_CSS } from "./export-html-styles";

export interface CaptureEditorHTMLOptions {
  /**
   * §301: PDF rendering can never play video — a headless-Chrome print of a
   * `<video>` element is an inert box with no poster frame, worse than
   * useless. When true, every video (local file AND provider embed) is
   * replaced with a plain link to its resolved src instead of `controls`.
   */
  forPdf?: boolean;
}

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
export async function captureEditorHTML(
  editor: Editor,
  options?: CaptureEditorHTMLOptions,
): Promise<string> {
  const forPdf = options?.forPdf ?? false;
  const dom = editor.view.dom;

  // ── Collect code block data + clone, with windowing suspended ─────
  // §perf-large-file C4: under windowing, off-screen blocks are display:none —
  // reveal them ALL so the clone captures the FULL document, then re-window.
  // getComputedStyle() only works on elements in the live DOM, so collect here.
  // (No-op when no large-doc windowing controller is active.)
  const { clone, codeBlockInfos } = withVirtualizationSuspended(() => {
    const infos: CodeBlockInfo[] = [];
    for (const wrapper of dom.querySelectorAll(".code-block-wrapper")) {
      infos.push(collectCodeBlockInfo(wrapper));
    }
    return {
      clone: dom.cloneNode(true) as HTMLElement,
      codeBlockInfos: infos,
    };
  });

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
  for (const el of clone.querySelectorAll(".mermaid-template-wrapper"))
    el.remove();
  for (const el of clone.querySelectorAll(".mermaid-block-label")) el.remove();
  for (const el of clone.querySelectorAll(".mermaid-block-editing")) {
    el.classList.remove("mermaid-block-editing");
    el.classList.add("mermaid-block-preview");
  }
  // Normalize rendered SVG sizing for export: mermaid pins an inline
  // `max-width: <natural>px` that overrides our stylesheet, so diagrams render
  // at inconsistent sizes and tall ones overflow page bounds. Pin the natural
  // size from viewBox as width/height attributes and drop the inline cap so the
  // export/print CSS governs: small diagrams keep their natural size, large
  // ones shrink to the text column (and fit one page in print). See §5.12.
  for (const svg of clone.querySelectorAll(".mermaid-block-svg svg")) {
    const viewBox = svg.getAttribute("viewBox");
    const parts = viewBox?.split(/[\s,]+/).map(Number);
    if (parts && parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      svg.setAttribute("width", String(Math.round(parts[2])));
      svg.setAttribute("height", String(Math.round(parts[3])));
    }
    const svgStyle = (svg as SVGElement).style;
    svgStyle.removeProperty("max-width");
    svgStyle.removeProperty("width");
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

  // ── Videos: asset URL을 상대경로로 되돌린다 ────────────────────────
  // 50MB를 base64로 인라인하지 않는다 (§294). 내보낸 HTML은 동영상 파일이 함께
  // 이동해야 재생된다.
  //
  // ‼️ convertFileSrc는 플랫폼마다 다른 형태를 낸다: macOS/Linux는
  // `asset://localhost/…`, Windows는 `http(s)://asset.localhost/…`. 공통
  // 부분문자열 "asset.localhost/"로는 macOS/Linux 형태를 못 잡는다 — 그
  // 스킴은 "asset:" + "//" + "localhost/"라 "asset"과 "localhost" 사이에
  // 점(.)이 없다. 위 이미지 루프처럼 세 접두사를 각각 확인한다.
  const ASSET_URL_PREFIXES = [
    "http://asset.localhost/",
    "https://asset.localhost/",
    "asset://localhost/",
  ];
  for (const el of clone.querySelectorAll("video[src]")) {
    const src = el.getAttribute("src") || "";
    const prefix = ASSET_URL_PREFIXES.find((p) => src.startsWith(p));
    if (prefix) {
      const abs = decodeURIComponent(src.slice(prefix.length)).split("#")[0];
      // Relative to the exported document's own directory when the file is
      // under it — `assets/clip.mp4` stays `assets/clip.mp4`, and a nested
      // `media/sub/clip.mp4` keeps its full relative form, not just its
      // basename (an earlier version threw the folder away here entirely).
      // An out-of-tree absolute path (the user typed one elsewhere, or there
      // is no active document) is left absolute rather than reduced to a
      // basename — an absolute path still resolves on this machine, while a
      // bare basename resolves nowhere.
      const baseDir = activeFileDir();
      const relative = baseDir ? relativeToRoot(abs, baseDir) : null;
      el.setAttribute("src", relative ?? abs);
    } else if (src.includes("#")) {
      // §294 fix (M4 nit): a remote (non-asset) video keeps the
      // poster-forcing `#t=0.1` fragment (video-view.tsx) unless stripped
      // here too. Harmless for HTML playback, but for PDF export below this
      // becomes the LINK'S VISIBLE TEXT, so an untouched remote clip would
      // read "https://…/clip.mp4#t=0.1" instead of the clean URL.
      el.setAttribute("src", src.split("#")[0]);
    }
    el.removeAttribute("preload");

    // §294/§301 fix (I4): the exported `<video>` had no play affordance in
    // either destination. HTML can actually play it (`controls`); PDF cannot
    // play anything, so §301 calls for a plain link instead — no poster
    // frame pretending playback might happen.
    if (forPdf) {
      const href = el.getAttribute("src") || "";
      const link = document.createElement("a");
      link.className = "video-export-link";
      link.href = href;
      link.textContent = href;
      el.replaceWith(link);
    } else {
      el.setAttribute("controls", "");
    }
  }

  // §294 fix (I4): a provider embed's IDLE `.video-embed-card`
  // ("Click to load from …") has nothing to click and no link anywhere once
  // React is gone — dead in both HTML and PDF regardless of destination.
  // Replace it with a link to the ORIGINAL src the document carried
  // (`data-video-src`, set by video-view.tsx), not the constructed nocookie
  // iframe URL that only exists to be embedded.
  for (const el of clone.querySelectorAll(".video-embed-card")) {
    const href = el.getAttribute("data-video-src") || "";
    const link = document.createElement("a");
    link.className = "video-export-link";
    link.href = href;
    link.textContent = href;
    el.replaceWith(link);
  }

  // §294/§301 fix (M2): a PLAYING embed is a `.video-embed-frame` iframe —
  // unlike the idle card, that's self-contained and needs no JS, so it's left
  // untouched for HTML export (it plays fine when the exported file is opened
  // in a browser). PDF is the exception this fix closes: a headless-Chrome
  // print can never load a remote iframe any more than it can play a local
  // `<video>` (same §301 reasoning as above), so it gets the same
  // `data-video-src`-based link only when `forPdf`. Before this fix, nothing
  // converted this shape at all — a playing embed exported to PDF as a
  // verbatim, inert `<iframe>`.
  if (forPdf) {
    for (const el of clone.querySelectorAll(".video-embed-frame")) {
      const href = el.getAttribute("data-video-src") || "";
      const link = document.createElement("a");
      link.className = "video-export-link";
      link.href = href;
      link.textContent = href;
      el.replaceWith(link);
    }
  }

  // ── Shared media chrome (SVG/Mermaid/image): drop hover toolbar +
  //    edge-drag resize handles + the drag % readout ─────────────────
  for (const el of clone.querySelectorAll(".media-toolbar")) el.remove();
  for (const el of clone.querySelectorAll(".media-resize-handle")) el.remove();
  for (const el of clone.querySelectorAll(".media-resize-label")) el.remove();
  // §294 fix (I4/M4, dev/backlog.md 2026-08-22): one shared class covers
  // every media kind's in-progress caption edit — video had no equivalent to
  // image's dedicated input class, so exporting mid-caption-edit leaked a raw
  // `<input>` for video specifically. media-block.css's `.media-caption-input`
  // is used directly by image-view.tsx and video-view.tsx, and BlockCaption.tsx
  // (SVG §5.1 / Mermaid §5.5) now carries it too alongside its own
  // `block-caption-input` — so this one loop closes the gap for every media
  // kind instead of growing a selector list here each time a new one ships.
  for (const el of clone.querySelectorAll(".media-caption-input")) {
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
