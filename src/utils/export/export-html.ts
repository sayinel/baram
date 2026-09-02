import type { CodeBlockInfo } from "./export-html-code-block";
// §5.12 HTML Export — Standalone HTML document generator
import type { Editor } from "@tiptap/core";

import katexCSS from "katex/dist/katex.min.css?raw";

import { withVirtualizationSuspendedAsync } from "../../extensions/plugins/viewport-virtualize";
import { useSettingsStore } from "../../stores/settings/store";
import { settleHeavyBlocks } from "./export-heavy-blocks";
import { linkInternalReferences } from "./export-html-anchors";
import {
  cleanupBlockEditingArtifacts,
  expandCollapsedContent,
  hideAtomBlockEditingUI,
  stripEditingChrome,
} from "./export-html-chrome";
import {
  buildCodeBlockExport,
  collectCodeBlockInfo,
  escapeHTML,
} from "./export-html-code-block";
import { stripDisallowedLinkHrefs } from "./export-html-links";
import {
  convertImagesToDataURIs,
  resolveVideoEmbeds,
  resolveVideoSources,
  stripMediaChrome,
} from "./export-html-media";
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

  hideAtomBlockEditingUI(clone);

  await convertImagesToDataURIs(clone, dom);
  resolveVideoSources(clone, forPdf);
  resolveVideoEmbeds(clone, forPdf);
  stripMediaChrome(clone);

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

  cleanupBlockEditingArtifacts(clone);

  // ── Everything interactive, and anything collapsed ───────────────
  stripEditingChrome(clone, isAuthoredMarkup);
  expandCollapsedContent(clone);
  linkInternalReferences(clone, isAuthoredMarkup);

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

  // ── Last: no anchor leaves with a refused destination (issue 499) ─────
  // ‼️ Position matters more than the call. `resolveVideoSources` above
  // creates a fresh `<a href>` for a remote/data video, and an authored HTML
  // block brings its own anchors — this pass has to see all of them, so it
  // runs after every step that can add or rewrite an href, right before the
  // markup is read out. Pinned by export-link-policy.test.tsx.
  stripDisallowedLinkHrefs(clone);

  return clone.innerHTML;
}

/**
 * Content-Security-Policy for the exported document (issue 499).
 *
 * The export is a static page: no `<script>` is ever emitted, and every
 * formula, diagram and highlight is pre-rendered. `script-src 'none'` therefore
 * costs nothing and also refuses `javascript:` navigation — CSP3's navigation
 * check ("Should navigation request of type be blocked by Content Security
 * Policy?") runs a `javascript:` URL through the inline-script check, and only
 * `'unsafe-inline'` would let it through. This is the second layer behind the
 * anchor scrub in `captureEditorHTML`, for the case where an href gets past
 * it or the file is edited by hand afterwards.
 *
 * Deliberately narrow. No `default-src`: the page relies on inline `<style>`,
 * `style=""` on image wrappers, `data:` images and fonts, remote/file images —
 * and the same file is what headless Chrome prints for PDF, so a broad policy
 * would be a silent regression there. `object-src 'none'` matches what the
 * HTML-block sanitizer already strips; `base-uri 'none'` because nothing
 * emits a `<base>`. Delivered as `<meta>`, which CSP permits for these
 * directives, right after the charset declaration (the HTML spec wants the
 * encoding first) and before anything the policy governs.
 */
const EXPORT_CSP = "script-src 'none'; object-src 'none'; base-uri 'none'";

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
  <meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP}">
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
 *
 * ‼️ Kept here rather than moved out, together with the two code-block loops
 * above that share it: `wrappers` (collected from the live DOM) and
 * `cloneCodeBlocks` (collected from the clone) rely on filtering with the
 * SAME predicate to stay index-aligned — see the comment on `wrappers` above.
 * `stripEditingChrome` and `linkInternalReferences` also need this test, but
 * take it as a parameter instead of importing it back from here, so this file
 * does not become a dependency of the modules it depends on.
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
