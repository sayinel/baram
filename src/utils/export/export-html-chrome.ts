// §5.12 HTML Export — strip editing-only DOM state that must not survive into
// an export: node-type preview toggles (math/mermaid), selection/highlight
// classes, ProseMirror internals, and every interactive control.

import { retag } from "./export-html-anchors";

/**
 * Math and Mermaid atom blocks: keep the rendered output (KaTeX markup,
 * Mermaid SVG), remove every editing-only element and class.
 */
export function hideAtomBlockEditingUI(clone: HTMLElement): void {
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
}

/**
 * The remaining per-block-type editing state: block embeds, block/footnote
 * reference selection, block-id decorations, ProseMirror's own internals, the
 * block handle, find/replace highlights, ghost text, the list-atom fix widget,
 * and table styling for reliable PDF rendering.
 */
export function cleanupBlockEditingArtifacts(clone: HTMLElement): void {
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
}

/**
 * Expand anything the reader had collapsed.
 *
 * A PDF has no disclosure triangle. Content hidden behind one is content the
 * reader can never reach, so a collapsed callout, a folded heading or a closed
 * toggle would simply be missing from the document — a silent omission, which
 * is worse than a long page. Obsidian's PDF export makes the same call.
 */
export function expandCollapsedContent(clone: HTMLElement): void {
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
 *
 * `isAuthoredMarkup` is injected rather than imported from export-html.ts: it
 * has to stay co-located there with the two code-block loops it keeps aligned
 * (see that file), and importing it back here would pull this module into a
 * cycle with the orchestrator for no benefit.
 */
export function stripEditingChrome(
  clone: HTMLElement,
  isAuthoredMarkup: (el: Element) => boolean,
): void {
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
