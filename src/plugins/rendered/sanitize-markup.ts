// §394 spec 0073 D8 — the sanitizer for the HTML · SVG a plugin renderer returns. Its own DOMPurify
// instance: the HTML block's and the SVG sanitizer's threats are a user's own document, where a
// remote image is a feature; here the author is a plugin and a remote URL is a beacon the main
// CSP lets through (`img-src … https:`), so removing it is the only gate.
//
//   ① elements: the profile `{ html, svg }` (no `svgFilters`, no `mathMl` — `feImage` and MathML
//      go with them; `use`, `set`, `animate`, `foreignObject` are in no profile), plus FORBID_TAGS
//      for scripts and styles, frames and embeds, document-level elements, media and forms, and
//      `<dialog>`. `<button>` stays — it is `data-action`'s home. DOMPurify keeps a removed
//      element's children unless the tag is in its FORBID_CONTENTS default (`script`, `style`,
//      `iframe`, `audio`, `video`, … — 3.4.16), so a `<dialog>`'s text stays in the flow.
//   ② attributes: `style`, the top-layer entrances (`popover`, `popovertarget`,
//      `popovertargetaction`, `command`, `commandfor`), candidate lists (`srcset`, `sizes`), the
//      vim island markers, and `data-tauri-drag-region` (opens nothing today; blocked so a wider
//      window permission later cannot turn it on). Event handlers are in no profile.
//   ③ URLs by ATTRIBUTE, not by element: `href`/`xlink:href` on `<a>` pass `isAllowedLinkHref`;
//      `src`, `poster`, `background`, `href`, `xlink:href` anywhere else are `data:image/*` or
//      `#fragment`, or go.
//   ④ CSS references in ANY attribute: a value that names a resource the CSS way (a url token, a
//      URL-bearing function token, a string inside one) stays only when it is exactly one
//      `url(#…)` — an SVG paint server.
//   ⑤ a node cap; ⑥ a DocumentFragment to `append`, never a string parsed a second time.

import type { Config, DOMPurify as Purifier } from "dompurify";

import * as csstree from "css-tree";
import DOMPurify from "dompurify";

import {
  isAllowedLinkHref,
  SANITIZER_ALLOWED_URI_REGEXP,
} from "../../utils/link-href";
import {
  forEachResourceName,
  forEachUrlBearingFunction,
} from "../../utils/theme-css/css-refs";
import { VIM_ISLAND_MARKERS } from "../../utils/vim-island-markers";
import { MAX_RENDERED_NODES } from "./limits";

export interface SanitizedMarkup {
  /** What to `append` into the block's shadow root. */
  fragment: DocumentFragment;
  /** Element and text nodes in `fragment` — the measure the cap uses. */
  nodes: number;
  /**
   * Elements and attributes DOMPurify removed — logged in a development build only (§6). A LOWER
   * bound: DOMPurify 3.4.16 (no `FORCE_BODY`) parses the input as a document and returns its
   * `<body>`, so what the HTML parser puts into `<head>` — a leading `<script>`, `<style>`,
   * `<link>`, `<meta>`, `<base>` or `<title>` — is dropped without being visited and is not counted
   * (measured: `<script></script><p>x</p>` → 0, `<p>x</p><script></script>` → 1).
   */
  removed: number;
}

/** D8 ① */
const FORBIDDEN_TAGS = [
  "audio",
  "base",
  "datalist",
  "dialog",
  "embed",
  "fieldset",
  "form",
  "iframe",
  "input",
  "label",
  "link",
  "meta",
  "object",
  "option",
  "output",
  "picture",
  "script",
  "select",
  "source",
  "style",
  "textarea",
  "track",
  "video",
];

/** D8 ② */
const FORBIDDEN_ATTRS = [
  "command",
  "commandfor",
  "data-tauri-drag-region",
  "popover",
  "popovertarget",
  "popovertargetaction",
  "sizes",
  "srcset",
  "style",
  ...VIM_ISLAND_MARKERS,
];

/** D8 ③ — the attributes that can make a document load something, judged on every element. */
const URL_ATTRS: ReadonlySet<string> = new Set([
  "background",
  "href",
  "poster",
  "src",
  "xlink:href",
]);

const CONFIG: Config & { RETURN_DOM_FRAGMENT: true } = {
  ALLOWED_URI_REGEXP: SANITIZER_ALLOWED_URI_REGEXP,
  FORBID_ATTR: FORBIDDEN_ATTRS,
  FORBID_TAGS: FORBIDDEN_TAGS,
  RETURN_DOM_FRAGMENT: true,
  USE_PROFILES: { html: true, svg: true },
};

let purifier: null | Purifier = null;

/** `html` as a fragment the host may append into a shadow root; over the node cap, a throw. */
export function sanitizePluginMarkup(html: string): SanitizedMarkup {
  const instance = getPurifier();
  const fragment = instance.sanitize(html, CONFIG);
  const removed = instance.removed.length;
  const nodes = countNodes(fragment);
  if (nodes > MAX_RENDERED_NODES) {
    throw new Error(
      `rendered output has more than ${MAX_RENDERED_NODES} nodes`,
    );
  }
  return { fragment, nodes, removed };
}

/** Element and text nodes under `root`. */
function countNodes(root: DocumentFragment): number {
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  let count = 0;
  while (walker.nextNode()) count += 1;
  return count;
}

/**
 * This sanitizer's DOMPurify instance, made on first use. Hooks are per instance: the hook below
 * applies to plugin output and to nothing the app's own sanitizers handle.
 *
 * The hook only ever REMOVES (`keepAttr = false`), never `forceKeepAttr` — DOMPurify's own checks
 * (`ALLOWED_URI_REGEXP`, its `data:` rule for `DATA_URI_TAGS`, the `attributename`/`href` rule)
 * still run after it, so this narrows what DOMPurify allows and cannot widen it.
 */
function getPurifier(): Purifier {
  if (purifier) return purifier;
  const created = DOMPurify(window);
  created.addHook("uponSanitizeAttribute", (node, data) => {
    if (!data.keepAttr) return;
    const value = data.attrValue;
    if (URL_ATTRS.has(data.attrName)) {
      data.keepAttr =
        node.localName === "a" &&
        (data.attrName === "href" || data.attrName === "xlink:href")
          ? isAllowedLinkHref(value)
          : isEmbeddable(value);
      return;
    }
    // ‼️ Only a value holding "(" can carry a url or function token: CSS Syntax makes either only
    // from an ident followed by a literal U+0028, which no escape can stand in for. The check
    // keeps the tokenizer off every class, id and data attribute.
    if (
      value.includes("(") &&
      namesAResource(value) &&
      !isFragmentUrlOnly(value)
    ) {
      data.keepAttr = false;
    }
  });
  purifier = created;
  return created;
}

/**
 * D8 ③ — `data:image/*` (any case) or a fragment of this document. The scheme is the URL
 * parser's to decide; the media type is the data URL's path up to `;` or `,`, compared without
 * case after the leading whitespace a data URL processor strips.
 */
function isEmbeddable(value: string): boolean {
  if (value.startsWith("#")) return true;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "data:" &&
    url.pathname.trimStart().toLowerCase().startsWith("image/")
  );
}

/** D8 ④ — the value is exactly one url token naming a fragment (`url(#g)`). */
function isFragmentUrlOnly(value: string): boolean {
  const tokens: Array<[number, string]> = [];
  csstree.tokenize(value, (type, start, end) => {
    if (type !== csstree.tokenTypes.WhiteSpace) {
      tokens.push([type, value.slice(start, end)]);
    }
  });
  return (
    tokens.length === 1 &&
    tokens[0][0] === csstree.tokenTypes.Url &&
    csstree.url.decode(tokens[0][1]).startsWith("#")
  );
}

/** D8 ④ — the value names a resource the CSS way: the theme pipeline's two scans, unchanged. */
function namesAResource(value: string): boolean {
  let found = false;
  forEachResourceName(value, () => {
    found = true;
  });
  forEachUrlBearingFunction(value, () => {
    found = true;
  });
  return found;
}
