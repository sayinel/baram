// §5.12 HTML Export — Code block pure functions

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
  exportDiv.style.cssText = "margin:1em 0;overflow:hidden;";

  // Language label
  if (info.lang) {
    const langLabel = document.createElement("div");
    langLabel.style.cssText = `font-family:${MONO_FONT};font-size:0.7rem;padding:2px 8px;background:${s.langBg};border:1px solid ${s.langBorder};border-bottom:none;border-radius:6px 6px 0 0;color:${s.langColor};`;
    langLabel.textContent = info.lang;
    exportDiv.appendChild(langLabel);
  }

  const body = document.createElement("div");
  const hasLang = !!info.lang;
  body.style.cssText = `display:flex;font-family:${MONO_FONT};font-size:0.875em;line-height:1.6;background:${s.bodyBg};border:1px solid ${s.bodyBorder};${hasLang ? "border-top:none;" : ""}border-radius:${hasLang ? "0 0 6px 6px" : "6px"};overflow-x:auto;color:${s.bodyColor};`;

  // Line numbers gutter
  if (info.lineNumbers && info.lineNumbers.length > 0) {
    const gutter = document.createElement("pre");
    gutter.style.cssText = `flex-shrink:0;margin:0;padding:0.75em;color:${s.gutterColor};text-align:right;border-right:1px solid ${s.gutterBorder};background:inherit;user-select:none;font:inherit;line-height:inherit;`;
    gutter.textContent = info.lineNumbers.join("\n");
    body.appendChild(gutter);
  }

  // Code content with highlighted spans
  const pre = document.createElement("pre");
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

/** Collect code block data from the live DOM (before cloning) */
export function collectCodeBlockInfo(wrapper: Element): CodeBlockInfo {
  const cmEditor = wrapper.querySelector(".cm-editor");
  if (!cmEditor)
    return {
      lang: "",
      style: "default",
      lineNumbers: null,
      highlightedLines: [],
    };

  const lang =
    wrapper.getAttribute("data-language") ||
    (wrapper.querySelector(".code-block-lang-select") as HTMLSelectElement)
      ?.value ||
    "";
  const style = wrapper.getAttribute("data-style") || "default";

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
