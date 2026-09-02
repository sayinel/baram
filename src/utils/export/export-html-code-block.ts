// §5.12 HTML Export — Code block pure functions

import { lightHighlightDeclarations } from "../../extensions/nodes/code-block-highlight";
import { CODE_STYLE_MAP, MONO_FONT } from "./export-html-styles";

export interface CodeBlockInfo {
  highlightedLines: string[];
  lang: string;
  lineNumbers: null | string[];
  style: string;
}

/** Build export DOM for a code block — uses inline styles for reliable PDF rendering */
export function buildCodeBlockExport(info: CodeBlockInfo): HTMLElement {
  const s = CODE_STYLE_MAP[info.style] || CODE_STYLE_MAP.default;

  const exportDiv = document.createElement("div");
  // Both a class AND inline styles. The inline styles carry the per-variant
  // palette and are what actually paints; the class is how the export
  // stylesheet, the print rules (`page-break-inside: avoid`) and the tests
  // address the block. It used to carry only the styles, which left every
  // `.code-block-export` rule in export-html-styles.ts dead.
  exportDiv.className = "code-block-export";
  exportDiv.dataset.style = info.style;
  exportDiv.style.cssText = "margin:1em 0;overflow:hidden;";

  // Language label
  if (info.lang) {
    const langLabel = document.createElement("div");
    langLabel.className = "code-block-export-lang";
    langLabel.style.cssText = `font-family:${MONO_FONT};font-size:0.7rem;padding:2px 8px;background:${s.langBg};border:1px solid ${s.langBorder};border-bottom:none;border-radius:6px 6px 0 0;color:${s.langColor};`;
    langLabel.textContent = info.lang;
    exportDiv.appendChild(langLabel);
  }

  const body = document.createElement("div");
  body.className = "code-block-body";
  const hasLang = !!info.lang;
  body.style.cssText = `display:flex;font-family:${MONO_FONT};font-size:0.875em;line-height:1.6;background:${s.bodyBg};border:1px solid ${s.bodyBorder};${hasLang ? "border-top:none;" : ""}border-radius:${hasLang ? "0 0 6px 6px" : "6px"};overflow-x:auto;color:${s.bodyColor};`;

  // Line numbers gutter
  if (info.lineNumbers && info.lineNumbers.length > 0) {
    const gutter = document.createElement("pre");
    gutter.className = "code-block-gutter";
    gutter.style.cssText = `flex-shrink:0;margin:0;padding:0.75em;color:${s.gutterColor};text-align:right;border-right:1px solid ${s.gutterBorder};background:${s.gutterBg};user-select:none;font:inherit;line-height:inherit;`;
    gutter.textContent = info.lineNumbers.join("\n");
    body.appendChild(gutter);
  }

  // Code content with highlighted spans
  const pre = document.createElement("pre");
  pre.className = "code-block-code";
  pre.style.cssText =
    "flex:1;margin:0;padding:0.75em 1em;border:none;border-radius:0;background:none;font:inherit;line-height:inherit;overflow-x:visible;";
  const code = document.createElement("code");
  code.style.cssText =
    "background:none;border:none;padding:0;font:inherit;line-height:inherit;color:inherit;";
  code.innerHTML = info.highlightedLines.join("\n");
  pre.appendChild(code);
  body.appendChild(pre);

  exportDiv.appendChild(body);
  return exportDiv;
}

/**
 * Collect code block data from the live DOM (before cloning).
 *
 * `text` is the block's content taken from the ProseMirror node — the only
 * COMPLETE copy. See the CodeMirror note below for why the DOM is not one.
 *
 * `fallbackLineNumbers` is the same `codeBlockLineNumbers` setting CodeMirror
 * itself reads, used when there is no mounted CodeMirror to ask. Guessing here
 * (always on, or always off) would print a document that disagrees with the one
 * on screen.
 */
export function collectCodeBlockInfo(
  wrapper: Element,
  text: string,
  fallbackLineNumbers = false,
): CodeBlockInfo {
  const authoritative = splitCodeLines(text);
  const lang =
    wrapper.getAttribute("data-language") ||
    (wrapper.querySelector(".code-block-lang-select") as HTMLSelectElement)
      ?.value ||
    "";
  const style = wrapper.getAttribute("data-style") || "default";

  const cmEditor = wrapper.querySelector(".cm-editor");
  // ‼️ No CodeMirror means the block never mounted — code-block-node-view.ts
  // defers that until the block nears the viewport, and shows
  // `.code-block-placeholder` (the raw text) meanwhile. `captureEditorHTML`
  // wakes every such block and waits for it before getting here, so this branch
  // is the fallback for a block that never landed, not the normal path.
  //
  // Returning `highlightedLines: []` used to make the caller SKIP the block,
  // leaving the live wrapper — its `<select>`, its AI button and its
  // unhighlighted placeholder — in the export verbatim. That was the defect the
  // user reported. Falling back to the placeholder's own text loses only the
  // syntax colours: the language label, the line numbers and the frame are all
  // still correct.
  if (!cmEditor) {
    return plainInfo(lang, style, authoritative, fallbackLineNumbers);
  }

  // Highlighted lines with computed inline styles
  const highlightedLines: string[] = [];
  for (const lineEl of cmEditor.querySelectorAll(".cm-content .cm-line")) {
    highlightedLines.push(extractHighlightedLineHTML(lineEl as HTMLElement));
  }

  // Strip trailing empty lines added by CodeMirror
  while (
    highlightedLines.length > 0 &&
    highlightedLines[highlightedLines.length - 1] === ""
  ) {
    highlightedLines.pop();
  }

  // ‼️ CodeMirror renders only its own VIEWPORT. `captureEditorHTML` mounts
  // every code block in the document, including ones far off-screen, and CM
  // then draws a fraction of their lines — measured at 38 of 500 for a block
  // below the fold. Reading the export's text from `.cm-line` therefore
  // truncates long code without a word of warning, which is worse than the
  // unstyled block this whole change set out to fix.
  //
  // So the rendered lines are used only when they account for the WHOLE block.
  // When they do not, the colours are unusable — they belong to a different,
  // shorter document — and complete plain text is the honest trade. A block
  // short enough to fit CM's viewport, which is nearly all of them, keeps its
  // highlighting.
  if (highlightedLines.length !== authoritative.length) {
    return plainInfo(lang, style, authoritative, fallbackLineNumbers);
  }

  // Line numbers: check if gutter is present, then generate 1..N
  const hasLineNumbers = !!cmEditor.querySelector(".cm-lineNumbers");
  const lineNumbers = hasLineNumbers
    ? highlightedLines.map((_, i) => String(i + 1))
    : null;

  return { lang, style, lineNumbers, highlightedLines };
}

/** Escape HTML special characters in code text content */
export function escapeCodeHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape HTML special characters in title */
export function escapeHTML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Extract highlighted HTML from a CodeMirror .cm-line element,
 * reading computed styles from the live DOM to produce inline styles.
 */
export function extractHighlightedLineHTML(lineEl: HTMLElement): string {
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
      )
        continue;
      const text = escapeCodeHTML(child.textContent || "");
      if (!text) continue;

      // ‼️ Read the token's CLASS and resolve it to the LIGHT palette, rather
      // than reading `getComputedStyle().color` — which returns whatever the
      // EDITOR is wearing. A dark-theme export used to put light-grey code onto
      // the white page an export always is, where it is very nearly invisible.
      // See lightHighlightDeclarations for why the fix cannot be a
      // colour→colour map.
      const decls = lightHighlightDeclarations(child.classList);
      html += decls ? `<span style="${decls}">${text}</span>` : text;
    }
  }
  return html;
}

/** An unhighlighted block, complete — the shape both fallbacks want. */
function plainInfo(
  lang: string,
  style: string,
  lines: string[],
  withLineNumbers: boolean,
): CodeBlockInfo {
  return {
    lang,
    style,
    lineNumbers: withLineNumbers ? lines.map((_, i) => String(i + 1)) : null,
    highlightedLines: lines.map(escapeCodeHTML),
  };
}

/** Code text to lines, without the trailing blank CodeMirror likes to add. */
function splitCodeLines(text: string): string[] {
  const lines = text.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
