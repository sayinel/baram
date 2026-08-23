import type { CodeBlockInfo } from "./export-html-code-block";
// §5.12 HTML Export — Standalone HTML document generator
import type { Editor } from "@tiptap/core";

import katexCSS from "katex/dist/katex.min.css?raw";

import { withVirtualizationSuspendedAsync } from "../../extensions/plugins/viewport-virtualize";
import { useSettingsStore } from "../../stores/settings/store";
import { activeFileDir } from "../active-file-dir";
import { isRemoteOrData } from "../media-src";
import { relativeToRoot } from "../path-utils";
import { settleHeavyBlocks } from "./export-heavy-blocks";
import {
  buildCodeBlockExport,
  collectCodeBlockInfo,
  escapeHTML,
} from "./export-html-code-block";
import { buildExportStylesheet } from "./export-html-styles";
import { inlineKatexFonts } from "./export-katex-fonts";

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

  // ── Wake the deferred blocks, then collect + clone ────────────────
  // Two independent mechanisms hide content from a naive clone, and BOTH have
  // to be lifted before the DOM is read:
  //
  //   1. §perf-large-file C4 windowing puts off-screen blocks at display:none.
  //      `withVirtualizationSuspendedAsync` reveals them all, then re-windows.
  //      (No-op when no large-doc windowing controller is active.)
  //   2. Heavy blocks — code, math, Mermaid — defer their CONTENT until they
  //      near the viewport, revealed or not. `settleHeavyBlocks` mounts them
  //      and waits for the renders to land. Without it, every block the reader
  //      had not scrolled to exported as its placeholder: raw text under a
  //      language `<select>`, an empty formula, a missing diagram.
  //
  // The reveal has to hold across the wait, which is why the async variant
  // exists: re-windowing before the renders land would hide them again.
  //
  // getComputedStyle() only works on elements in the live DOM, so the code
  // blocks' syntax colours are collected here, before the clone.
  const { clone, codeBlockInfos } = await withVirtualizationSuspendedAsync(
    async () => {
      const unsettled = await settleHeavyBlocks(dom);
      if (unsettled.length > 0) {
        // Not fatal: each block kind has a fallback below. Worth saying out
        // loud, because a silently degraded export is what this whole path
        // exists to stop being.
        console.warn(
          `[export] ${unsettled.length} block(s) did not finish rendering and were exported in fallback form:`,
          unsettled.map((b) => b.kind),
        );
      }
      const lineNumbers = useSettingsStore.getState().codeBlockLineNumbers;
      // ‼️ The block's text comes from the DOCUMENT, not from the DOM. A mounted
      // CodeMirror renders only its viewport, and a lazily-woken off-screen
      // block therefore has a fraction of its lines in the DOM (38 of 500,
      // measured). Walking the doc gives every block's full text; the two
      // sequences line up because `descendants` and `querySelectorAll` are both
      // document order.
      const codeTexts: string[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === "codeBlock") codeTexts.push(node.textContent);
      });
      // ‼️ `isAuthoredMarkup` is what keeps the two sequences aligned, not just
      // a courtesy to the author. An HTML block can contain a literal
      // `<div class="code-block-wrapper">` — nothing stops someone writing one
      // — and it has no ProseMirror codeBlock behind it. Counting it here would
      // shift every later block onto the wrong text, so each one would print
      // some OTHER block's code. Excluding it also means the export leaves that
      // markup exactly as written, which is the same rule the control strip
      // follows.
      const wrappers = [...dom.querySelectorAll(".code-block-wrapper")].filter(
        (el) => !isAuthoredMarkup(el),
      );
      if (wrappers.length !== codeTexts.length) {
        console.warn(
          `[export] ${wrappers.length} code block element(s) but ${codeTexts.length} in the document — falling back to unhighlighted text`,
        );
      }
      const infos: CodeBlockInfo[] = wrappers.map((wrapper, i) =>
        collectCodeBlockInfo(wrapper, codeTexts[i] ?? "", lineNumbers),
      );
      return {
        clone: dom.cloneNode(true) as HTMLElement,
        codeBlockInfos: infos,
      };
    },
  );

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
  //
  // ‼️ `.mermaid-block svg`, not `.mermaid-block-svg svg`. The latter was a dead
  // selector: `.mermaid-block-svg` only exists in the EDITING and FULLSCREEN
  // branches of mermaid-block-view. The branch an export actually captures —
  // unselected — puts the SVG in `.media-render > .media-resize-frame >
  // .media-resize-content`, which this never matched, so no exported diagram
  // was ever normalized. (It went unnoticed because no diagram reached the
  // export at all until the lazy blocks were woken above.)
  for (const svg of clone.querySelectorAll(".mermaid-block svg")) {
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
    //
    // §301 ruling (round 3): in PDF, a LOCAL file gets plain text rather than
    // an anchor. Its href can only ever be document-relative, and Chrome
    // resolves that against the print-time base URL — the temp file
    // `generate_pdf` writes and then deletes (src-tauri/src/export/mod.rs:116
    // and :213). So the annotation points into a directory that is gone before
    // anyone can click it: the link invites a click and silently does nothing,
    // which is exactly what the user reported. Plain text is honest about what
    // the reader can actually do. A REMOTE src keeps its anchor — that one is
    // absolute and demonstrably works (the annotation is emitted; see
    // test_generate_pdf_emits_link_annotations).
    //
    // `isRemoteOrData` is the shared answer to "is this ours to resolve?"
    // (utils/media-src.ts), reused rather than re-spelled here — a second
    // predicate for the same question is how the two sides drift apart.
    if (forPdf) {
      const src = el.getAttribute("src") || "";
      if (isRemoteOrData(src)) {
        replaceWithExportLink(el, src, true);
      } else {
        replaceWithExportText(el, src);
      }
    } else {
      el.setAttribute("controls", "");
    }
  }

  // §294 fix (I4) / §301: a provider embed exports as a LINK in BOTH
  // destinations, whichever of its two live shapes the document happens to be
  // showing — the idle `.video-embed-card` ("Click to load from …") or the
  // `.video-embed-frame` iframe that replaces it once the reader clicks play.
  // The link points at the ORIGINAL src the document carried
  // (`data-video-src`, set by video-view.tsx on both shapes), not the
  // constructed nocookie iframe URL that only exists to be embedded.
  //
  // ‼️ The frame used to be exempted for HTML export, on the claim that it is
  // "self-contained and plays fine when the exported file is opened in a
  // browser". Two things are wrong with that:
  //   1. It is state-dependent. Whether the reader had clicked play before
  //      choosing Export decided whether the .html got a player or a link —
  //      same document, same command, two different files. Nothing about the
  //      document says which one it should be.
  //   2. It is false for the destination that matters. An exported .html is
  //      opened by double-clicking it, so the page origin is `file://`/null;
  //      a provider's embed player routinely refuses that origin and paints
  //      its (black) shell instead of the video. And export-html-styles.ts
  //      carries no `.video-embed-frame` rule — every rule for it in
  //      styles/editor/video.css is `.tiptap`-scoped and the export wrapper is
  //      `article.baram-export` — so the surviving iframe rendered at the UA
  //      default 300x150 rather than 100%-wide 16:9. A dead player at the
  //      wrong size is worse than the URL it came from.
  for (const el of clone.querySelectorAll(
    ".video-embed-card, .video-embed-frame",
  )) {
    replaceWithExportLink(el, el.getAttribute("data-video-src") || "", forPdf);
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
  // Unconditionally — an empty code block exports as an empty frame. The old
  // `highlightedLines.length === 0 → skip` left the LIVE wrapper in place, so
  // the one case that most needed replacing (a block that never mounted) was
  // the one case that kept its `<select>` and its AI button.
  // Same filter as the collection loop above, so index i means the same block
  // in both — and an authored `.code-block-wrapper` is left untouched.
  const cloneCodeBlocks = [
    ...clone.querySelectorAll(".code-block-wrapper"),
  ].filter((el) => !isAuthoredMarkup(el));
  cloneCodeBlocks.forEach((wrapper, i) => {
    const info = codeBlockInfos[i];
    if (!info) return;
    wrapper.replaceWith(buildCodeBlockExport(info));
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

  // ── Everything interactive, and anything collapsed ───────────────
  stripEditingChrome(clone);
  expandCollapsedContent(clone);
  linkInternalReferences(clone);

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
  ${katexStyles(editorHTML)}
  <style>${buildExportStylesheet()}</style>
</head>
<body>
  <article class="baram-export">${editorHTML}</article>
</body>
</html>`;
}

/**
 * A fragment-safe anchor name.
 *
 * ‼️ Both the `id` and the `href` are built from this one function, so they
 * cannot disagree. A block id is user-authored text — a space or a `#` in it
 * makes a raw `#block-my id` fragment point nowhere, and a space is not even
 * legal in an `id`. Encoding both sides keeps the link resolvable whatever the
 * author typed.
 */
function anchorFor(prefix: string, id: string): string {
  return `${prefix}-${encodeURIComponent(id)}`;
}

/**
 * This element's own caption, or null.
 *
 * ‼️ Scoped through `closest("figure.video-figure")`: a document-wide lookup
 * would hand every video the FIRST figcaption in the document, and every
 * single-video test would still pass, because in a one-video document the
 * first figcaption is the right one.
 */
function captionFor(el: Element): Element | null {
  return (
    el
      .closest("figure.video-figure")
      ?.querySelector("figcaption.video-caption") ?? null
  );
}

/**
 * Expand anything the reader had collapsed.
 *
 * A PDF has no disclosure triangle. Content hidden behind one is content the
 * reader can never reach, so a collapsed callout, a folded heading or a closed
 * toggle would simply be missing from the document — a silent omission, which
 * is worse than a long page. Obsidian's PDF export makes the same call.
 */
function expandCollapsedContent(clone: HTMLElement): void {
  for (const el of clone.querySelectorAll(
    ".callout-body-collapsed, .fold-hidden, .fold-collapsed",
  )) {
    el.classList.remove(
      "callout-body-collapsed",
      "fold-hidden",
      "fold-collapsed",
    );
  }
  for (const el of clone.querySelectorAll('.toggle[data-open="false"]')) {
    el.setAttribute("data-open", "true");
  }
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
 * Is this element part of the DOCUMENT rather than part of the editor?
 *
 * ‼️ An HTML block renders the author's own (sanitized) markup verbatim —
 * html-block-view.tsx sets it with `dangerouslySetInnerHTML` into
 * `.html-block-render`. A `<button>` in there is not chrome the editor added
 * around the content; it IS the content, written by the person exporting. The
 * blanket "remove every control" rule below is right for everything the editor
 * put on the page and wrong for everything the author put in it, and this is
 * where that line falls.
 *
 * The block's own chrome — its `html-block-textarea`, its header — sits OUTSIDE
 * `.html-block-render`, so it is still removed.
 */
function isAuthoredMarkup(el: Element): boolean {
  return el.closest(".html-block-render") !== null;
}

/**
 * KaTeX's stylesheet — fonts embedded — or nothing at all.
 *
 * The 20 inlined woff2 faces are ~400KB of base64 and a document with no
 * formula has nothing to spend them on. But the answer for that document is to
 * ship NO KaTeX block, not the stylesheet without the fonts: every `@font-face`
 * in it points at `fonts/KaTeX_*.woff2` relative to the page, and in an export
 * that directory does not exist — so the lighter version is 23KB of rules
 * nothing matches plus twenty requests that 404.
 *
 * `katex` is KaTeX's own class prefix and appears on every rendered formula,
 * inline or block. The test errs toward INCLUDING: `.math-block-katex` (the
 * preview host, present even when the formula did not render) also matches, so
 * a document with math keeps the stylesheet even if something went wrong
 * upstream.
 */
function katexStyles(editorHTML: string): string {
  if (!editorHTML.includes("katex")) return "";
  return `<style>${inlineKatexFonts(katexCSS)}</style>`;
}

/**
 * Turn same-document references into real links.
 *
 * User report (2026-08-23): "블록참조 등 참조 링크 사라짐". They do not vanish —
 * the chip and the superscript number both print. What vanishes is the ABILITY
 * TO FOLLOW them: a block reference is navigated by a Cmd+click handler
 * (block-reference-view.tsx) and a footnote by an onClick, and an exported
 * document runs no JavaScript. So the reader sees a reference and cannot use
 * it. Chrome emits a PDF link annotation for a same-document anchor, so giving
 * the export the ids and hrefs the editor never needed makes both work.
 *
 * ‼️ Only same-document targets. A reference into another note (`data-target`
 * non-empty) has no destination inside a single exported file, and a footnote
 * reference whose definition was not exported has none either — those keep the
 * chip and stay unlinked. A link that resolves to nothing is not a lesser
 * version of a working link: it invites a click and silently does nothing,
 * which is the exact complaint §301 answered for local video.
 */
function linkInternalReferences(clone: HTMLElement): void {
  // ── Block references ──────────────────────────────────────────────
  // ‼️ `.block-reference` carries `data-block-id` too — it names the block it
  // POINTS AT. Without this guard every reference would also claim to BE its
  // own target, and `#block-intro` would resolve to the chip rather than to
  // the paragraph.
  const blockTargets = new Set<string>();
  for (const el of clone.querySelectorAll("[data-block-id]")) {
    if (el.classList.contains("block-reference")) continue;
    // An author can write `data-block-id` in a raw HTML block; that is their
    // markup, not a Baram block id, and minting an anchor on it would let it
    // shadow a real target.
    if (isAuthoredMarkup(el)) continue;
    const id = el.getAttribute("data-block-id");
    // First wins: a duplicate id in the document would make the anchor
    // ambiguous, and the earlier block is the one the reader reaches by
    // reading forward.
    if (!id || blockTargets.has(id)) continue;
    blockTargets.add(id);
    el.setAttribute("id", anchorFor("block", id));
  }
  for (const el of clone.querySelectorAll(".block-reference")) {
    const id = el.getAttribute("data-block-id");
    const target = el.getAttribute("data-target");
    if (!id || target || !blockTargets.has(id)) continue;
    retag(el, "a").setAttribute("href", `#${anchorFor("block", id)}`);
  }

  // ── Footnotes, in both directions ─────────────────────────────────
  const definitions = new Set<string>();
  for (const el of clone.querySelectorAll(
    ".footnote-definition[data-identifier]",
  )) {
    const id = el.getAttribute("data-identifier");
    if (!id || definitions.has(id)) continue;
    definitions.add(id);
    el.setAttribute("id", anchorFor("fn", id));
  }

  const firstRef = new Set<string>();
  for (const el of clone.querySelectorAll(".footnote-ref[data-identifier]")) {
    const id = el.getAttribute("data-identifier");
    if (!id || !definitions.has(id)) continue;
    const link = retag(el, "a");
    link.setAttribute("href", `#${anchorFor("fn", id)}`);
    // The back-link needs somewhere to land, and only the FIRST occurrence can
    // own the id — the same note may be referenced several times.
    if (!firstRef.has(id)) {
      firstRef.add(id);
      link.setAttribute("id", anchorFor("fnref", id));
    }
  }

  for (const el of clone.querySelectorAll(
    ".footnote-definition[data-identifier]",
  )) {
    const id = el.getAttribute("data-identifier");
    const label = el.querySelector(".footnote-definition-label");
    if (!id || !label || !firstRef.has(id)) continue;
    retag(label, "a").setAttribute("href", `#${anchorFor("fnref", id)}`);
  }
}

/**
 * Replace one media element with the export's link stand-in.
 *
 * §301 ruling (export-defect round, 2026-08-22): when the node HAS a caption,
 * **the caption becomes the link** and no separate URL line is emitted. The
 * `figcaption` already prints right below, so a URL line above it is pure
 * redundancy — and that redundancy is exactly what a user read as "the PDF
 * only shows source code" (the printed path/URL is character-for-character the
 * inside of the markdown's parentheses). For a local file the URL is a *dead*
 * link in a PDF besides: the href is document-relative while the print-time
 * base URL is a temp file that `generate_pdf` deletes on return
 * (src-tauri/src/export/mod.rs:116 and :213), so it costs a line and returns
 * nothing. Making that href absolute instead was rejected — it would resolve
 * on the exporting machine only, and it leaks `/Users/<name>/…` into a
 * document meant to be shared.
 *
 * An UNCAPTIONED node keeps the URL as its visible text: with no caption there
 * is nothing else left to say a video was ever here.
 *
 * ‼️ The tradeoff, recorded so it can be reversed knowingly rather than
 * rediscovered: on PAPER a hyperlink is invisible, so a printed provider embed
 * loses its `https://youtu.be/…` entirely under this rule. The alternative was
 * to keep URL text for provider embeds and caption text for local files; it
 * was rejected because it leaves the two shapes inconsistent, and a Baram PDF
 * is read on screen far more often than it is printed. Reverse this if that
 * ever stops being true.
 *
 * ‼️ `useCaption` is **PDF only**, and that scope is load-bearing. An earlier
 * round applied caption-as-link to HTML export too, reasoning that the ruling
 * was destination-independent. The user re-exported and read the result as
 * "the YouTube embed vanished entirely, only the caption is left" — which is
 * the honest reading: in HTML the caption-link collapses a 16:9 embed to one
 * line whose text is the caption that was already there, so nothing on the
 * page says a video was there or where it pointed. Their own prescription
 * ("just make it a clickable link") describes the pre-extension HTML output
 * exactly: a visible, clickable `https://youtu.be/…`.
 *
 * The asymmetry is deliberate and each half is justified by its destination.
 * HTML: the URL is live and identifies the target, so show it. PDF: the ruling
 * judged the URL line redundant against the caption printed right below it,
 * and it is also the destination where a document-relative href cannot resolve
 * at all (see the note above), so there is less to lose by hiding it.
 */
function replaceWithExportLink(
  el: Element,
  href: string,
  useCaption: boolean,
): void {
  const link = document.createElement("a");
  link.className = "video-export-link";
  link.href = href;

  const caption = captionFor(el);
  const captionText = caption?.textContent ?? "";

  // ‼️ An in-progress caption edit keeps its text in an `<input value>`, not in
  // textContent, so it reads as empty here and falls back to the URL — the
  // pre-ruling shape. That input is normalized to a plain span further up in
  // captureEditorHTML, so exporting mid-edit still prints the caption; it just
  // prints the URL line above it too.
  if (useCaption && caption && captionText.trim()) {
    link.textContent = captionText;
    caption.textContent = "";
    caption.appendChild(link);
    el.remove();
    return;
  }

  link.textContent = href;
  el.replaceWith(link);
}

/**
 * Replace a media element with plain, unlinked text — for the PDF case where no
 * href could resolve (see the call site for why a local file has none).
 *
 * When the node HAS a caption, nothing is emitted at all: the `figcaption`
 * right below already prints that text, and printing it twice is the exact
 * redundancy the §301 ruling removed. When it has none, the path is emitted, so
 * a video never vanishes from the page without a trace.
 *
 * A `<span>`, not an `<a>`: it must not look clickable, because it is not. It
 * carries `.video-export-path` purely for the wrapping behaviour a long path
 * needs (export-html-styles.ts) — no colour and no underline, so it reads as
 * body text, which is the honest signal.
 */
function replaceWithExportText(el: Element, path: string): void {
  if (captionFor(el)?.textContent?.trim()) {
    el.remove();
    return;
  }
  const span = document.createElement("span");
  span.className = "video-export-path";
  span.textContent = path;
  el.replaceWith(span);
}

/** Replace `el` with the same content and attributes under a different tag. */
function retag(el: Element, tagName: string): HTMLElement {
  const next = document.createElement(tagName);
  for (const attr of Array.from(el.attributes)) {
    next.setAttribute(attr.name, attr.value);
  }
  next.append(...el.childNodes);
  el.replaceWith(next);
  return next;
}

/**
 * Remove every interactive affordance from the clone.
 *
 * ‼️ This is a POSITIVE rule on purpose. It replaces a hand-maintained list of
 * class names (`.media-toolbar`, `.mermaid-context-menu`, …) that admitted
 * every control shipped after it was written: the code block's language
 * `<select>` and AI button, the callout's AI and collapse buttons, the math
 * block's AI button and the footnote's ↩ all reached the user's PDF because
 * nobody remembered to add a line here. An export contains nothing the reader
 * can press, so "remove the pressable things" is the rule the destination
 * actually implies — and it covers the next control automatically.
 *
 * Two exceptions, each with a reason a new control will not accidentally
 * inherit:
 *
 *   - A task checkbox is CONTENT. `- [x]` is part of the document, and a
 *     printed checklist has to show which items are ticked. It stays (disabled;
 *     `checked` still paints).
 *   - `.callout-icon-btn` is a button only so the type can be changed by
 *     clicking it — the icon inside it is content, and it is what makes a
 *     warning callout legible as a warning. It is downgraded to a `<span>`
 *     keeping the same class, so the callout's own stylesheet still lays the
 *     header out with the icon, the title and nothing else on one line.
 *
 * Widget decorations go too: every `Decoration.widget` in this codebase is an
 * editing affordance (fold arrows and their ellipsis, the AI diff controls, the
 * list atom fix, block-id hints) — none of them is document content.
 */
function stripEditingChrome(clone: HTMLElement): void {
  // `retag`, not a hand-rolled span: copying only `className` silently dropped
  // `title`, `aria-*` and every `data-*` the control carried.
  for (const el of clone.querySelectorAll(".callout-icon-btn")) {
    retag(el, "span").removeAttribute("type");
  }

  for (const el of clone.querySelectorAll("button, select, textarea")) {
    if (isAuthoredMarkup(el)) continue;
    el.remove();
  }
  for (const el of clone.querySelectorAll("input")) {
    if (isAuthoredMarkup(el)) continue;
    if ((el as HTMLInputElement).type === "checkbox") {
      (el as HTMLInputElement).disabled = true;
      // `checked` is a property, not an attribute — an unserialised property is
      // lost the moment this clone becomes a string, so every ticked box would
      // print empty.
      if ((el as HTMLInputElement).checked) el.setAttribute("checked", "");
      else el.removeAttribute("checked");
      continue;
    }
    el.remove();
  }

  for (const el of clone.querySelectorAll(".ProseMirror-widget")) el.remove();

  // Tiptap writes `white-space: pre-wrap` inline onto every NodeViewContent
  // host so ProseMirror's own whitespace handling survives inside a React
  // NodeView. In an export it only makes callout and footnote bodies keep the
  // source's stray newlines.
  for (const el of clone.querySelectorAll("[data-node-view-content]")) {
    (el as HTMLElement).style.removeProperty("white-space");
    el.removeAttribute("data-node-view-content");
  }
}
