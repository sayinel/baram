// §5.6 HTML block sanitization — extracted from the NodeView so it can be
// imported (and pinned) without dragging a React component along.

import DOMPurify from "dompurify";

import { SANITIZER_ALLOWED_URI_REGEXP } from "../link-href";
import { VIM_ISLAND_MARKERS } from "../vim-island-markers";
import { isSvgContent, sanitizeSvg } from "./svg-utils";

const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  // issue 499: the same destination policy a markdown link is held to —
  // DOMPurify's default set minus protocol-relative `//host`, which the
  // default counted as "relative" and let into the editor DOM as a live
  // anchor. DOMPurify applies it to every URI-bearing attribute (`src`,
  // `srcset`, … — not only `href`). One document, one rule
  // (utils/link-href.ts).
  ALLOWED_URI_REGEXP: SANITIZER_ALLOWED_URI_REGEXP,
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
 * `javascript:` URLs stay forbidden on both paths, and both paths take their
 * URI allowlist from utils/link-href.ts (issue 499).
 */
export function sanitizeHtmlBlock(html: string): string {
  return isSvgContent(html)
    ? sanitizeSvg(html)
    : DOMPurify.sanitize(html, SANITIZE_CONFIG);
}
