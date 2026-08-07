// §5.6 HTML block sanitization — extracted from the NodeView so it can be
// imported (and pinned) without dragging a React component along.

import DOMPurify from "dompurify";

import { VIM_ISLAND_MARKERS } from "../../extensions/plugins/vim/adapters/suspension";
import { isSvgContent, sanitizeSvg } from "./svg-utils";

const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  ADD_TAGS: [
    "img",
    "br",
    "hr",
    "a",
    "table",
    "tr",
    "td",
    "th",
    "thead",
    "tbody",
    "div",
    "span",
    "p",
    "strong",
    "em",
  ],
  ADD_ATTR: [
    "align",
    "src",
    "alt",
    "width",
    "height",
    "href",
    "class",
    "colspan",
    "rowspan",
  ],
  FORBID_ATTR: [
    "style",
    "onerror",
    "onload",
    "onclick",
    // vim island markers are an app capability — never document-grantable.
    ...VIM_ISLAND_MARKERS,
  ],
};

/**
 * Raw `<svg>` markup goes through the shared {@link sanitizeSvg} (svg profile +
 * inline `style`/presentation attrs/filters) so it renders with full fidelity;
 * everything else keeps the stricter HTML config. `<script>`, event handlers and
 * `javascript:` URLs stay forbidden on both paths.
 */
export function sanitizeHtmlBlock(html: string): string {
  return isSvgContent(html)
    ? sanitizeSvg(html)
    : DOMPurify.sanitize(html, SANITIZE_CONFIG);
}
