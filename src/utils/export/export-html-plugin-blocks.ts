// §394 spec 0073 D12 — a plugin-rendered block in an HTML · PDF export. The clone carries no shadow
// root (`attachShadow` defaults to `clonable: false`), so each clone root is paired, in document
// order, with its LIVE block, and the live host's shadow root becomes declarative shadow DOM:
// `<template shadowrootmode="open">` holding the sanitized `<style>` and markup. The HTML parser
// attaches it while parsing, so the export's `script-src 'none'` does not matter and its CSS stays
// in that block. A block that never drew exports as an ordinary code block of its source.
//
// ‼️ The export's trailing passes walk the clone with `querySelectorAll`, which does not enter a
// `<template>`'s content — so this pass scrubs each template's links itself
// (`stripDisallowedLinkHrefs`). Its images are `data:` already (the sanitizer, D8).
//
// ‼️ A `<style>` is serialized as raw text — its `</style` is not escaped, and the exported file's
// parser ends the element there. `sanitizePluginCss` refuses CSS that generates `</` (plan 0125
// P27 ①); this pass does not trust that and leaves out any `<style>` in the template whose content
// holds one (P27 ②) — the markup still exports, unstyled.

import { logger } from "../logger";
import { buildCodeBlockExport, escapeCodeHTML } from "./export-html-code-block";
import { stripDisallowedLinkHrefs } from "./export-html-links";

/** A rendered block as the editor holds it, with its node's source. */
export interface LivePluginBlock {
  live: HTMLElement;
  text: string;
}

/**
 * Replace every rendered root of `clone` (authored markup excepted — an HTML block may carry a
 * `data-plugin-block` of its own) with its export: declarative shadow DOM when its live block drew,
 * an ordinary code block otherwise. `blocks` is in document order, from the same nodes.
 */
export function embedPluginBlocks(
  clone: HTMLElement,
  blocks: readonly LivePluginBlock[],
  isAuthored: (el: Element) => boolean,
): void {
  const roots = [...clone.querySelectorAll("[data-plugin-block]")].filter(
    (el) => !isAuthored(el),
  );
  if (roots.length !== blocks.length) {
    console.warn(
      `[export] ${roots.length} rendered block element(s) but ${blocks.length} in the document`,
    );
  }
  roots.forEach((root, i) => {
    const block = blocks[i];
    if (block !== undefined) root.replaceWith(exportOf(block));
  });
}

function exportOf(block: LivePluginBlock): HTMLElement {
  const shadow =
    block.live.querySelector(".plugin-block-host")?.shadowRoot ?? null;
  if (shadow === null || shadow.childNodes.length === 0) {
    return buildCodeBlockExport({
      highlightedLines: block.text.split("\n").map(escapeCodeHTML),
      lang: block.live.dataset.lang ?? "",
      lineNumbers: null,
      style: "default",
    });
  }
  const template = document.createElement("template");
  template.setAttribute("shadowrootmode", "open");
  for (const node of shadow.childNodes) {
    template.content.append(node.cloneNode(true));
  }
  // P27 ② — every `<style>` in the template, not only the top-level one the view draws: the check
  // reads `innerHTML`, which is exactly what the serializer writes between the tags.
  for (const style of template.content.querySelectorAll("style")) {
    if (style.innerHTML.includes("</")) {
      logger.warn(
        `[export] a rendered \`\`\`${block.live.dataset.lang ?? ""} block's style would close itself; exported without it`,
      );
      style.remove();
    }
  }
  stripDisallowedLinkHrefs(template.content);
  const host = document.createElement("div");
  host.className = "plugin-block-export-host";
  host.append(template);
  const out = document.createElement("div");
  out.className = "plugin-block-export";
  out.append(host);
  return out;
}
