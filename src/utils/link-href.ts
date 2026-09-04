// issue 499 — which link destinations may go live.
//
// Asked at every point a link's destination stops being data and becomes a
// wired `href` or an OS request: Link.renderHTML (editor DOM, clipboard HTML,
// and — because export clones the editor DOM — HTML/PDF export), the Cmd+click
// navigation path, Link.parseHTML for pasted markup, the export's final
// anchor scrub, the markdown export's final link pass (Pandoc and Notion,
// export-markdown-links.ts, issue 527), and — ANDed with its own narrower
// prefix allowlist — the AI chat renderer (components/ai/markdown-url.ts).
// The document model is never consulted or changed: a refused destination
// stays in the file byte-for-byte (pipeline roundtrip pin) and is simply not
// connected to anything.
//
// The scheme set is DOMPurify's default `IS_ALLOWED_URI` — the policy the
// HTML-block sanitizer (utils/markdown/html-sanitize.ts) already applies to an
// `<a href>` inside an HTML block of the same document. A markdown link is
// held to the same line so one exported page has one rule. The cost is
// deliberate and worth stating precisely: `file:` and app-specific schemes
// (`obsidian://`, `zotero://`) render without a live href. In-app that changes
// nothing — the Tauri opener capability (`opener:default`) only ever opened
// http/https/mailto/tel — but in an exported page those links WERE clickable
// before and are not now. A refused destination is kept as an inert
// `data-href` (Link.renderHTML) so the clipboard still round-trips it and CSS
// can mark the link as dead; the export strips that attribute.
//
// Classification goes through the WHATWG URL parser, not a regex, because that
// is the parser the browser runs on `href` before deciding what it means: it
// strips leading/trailing C0 controls and spaces, removes ASCII tab/LF/CR
// anywhere, and lowercases the scheme — so `" JAVA\tscript:alert(1)"` is seen
// as `javascript:` here exactly as it is there. The substring selector this
// replaced (`a[href]:not([href *= 'javascript:' i])`) let `java\tscript:` in
// and kept `https://…?q=javascript:` out. Percent- or entity-encoded schemes
// need no special case: the URL parser does not decode them either, and an
// HTML parser has already decoded entities by the time an attribute is read.

const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set([
  "callto:",
  "cid:",
  "ftp:",
  "ftps:",
  "http:",
  "https:",
  "mailto:",
  "matrix:",
  "sms:",
  "tel:",
  "xmpp:",
]);

/** Base for scheme-less hrefs (relative paths, fragments, `www.…`). An href
 *  that carries its own scheme parses independently of it. */
const RELATIVE_BASE = "https://baram.invalid/";

/** The first characters the URL parser actually looks at: it drops leading
 *  C0 controls and spaces, and every ASCII tab/LF/CR, before anything else. */
function parserView(href: string): string {
  return href.replace(/^[\u0000-\u0020]+/, "").replace(/[\t\n\r]/g, ""); // eslint-disable-line no-control-regex
}

/**
 * May this destination be emitted as a live `href` / handed to the opener?
 *
 * `null`, `undefined` and `""` are "no destination" — there is nothing to
 * withhold, so they pass. An href the URL parser rejects fails closed: a
 * browser could not navigate it either, but "safe because it is broken" is
 * not a property to lean on at a security boundary.
 *
 * A protocol-relative destination (`//host/…`, or `\\host\…`, which the
 * parser reads the same way under a special-scheme base) is refused too. It
 * has no scheme of its own and borrows the DOCUMENT's — the webview's in the
 * editor, `file:` in an exported page, where `//host/share` is a UNC path.
 * Classifying it against the fixed base above would only report the base's
 * scheme, so the answer would be right by accident. Refuse instead of guess.
 */
export function isAllowedLinkHref(href: null | string | undefined): boolean {
  if (href === null || href === undefined || href === "") return true;
  if (/^[/\\]{2}/.test(parserView(href))) return false;
  let url: URL;
  try {
    url = new URL(href, RELATIVE_BASE);
  } catch {
    return false;
  }
  return ALLOWED_PROTOCOLS.has(url.protocol);
}

/**
 * The same policy in the shape DOMPurify consumes (`ALLOWED_URI_REGEXP`), for
 * the HTML-block and SVG/Mermaid sanitizers — so an anchor an author writes
 * inside an HTML block is held to exactly the rule a markdown link is.
 *
 * Reach: DOMPurify applies this pattern to EVERY attribute it does not list as
 * URI-safe — `href`, `src`, `srcset`, `xlink:href`, `action`, and any other
 * allowed attribute whose value is not plain text (class/id/title/alt/style
 * are exempt). So a protocol-relative `<img src="//cdn/x.png">` in an HTML
 * block loses its `src` too, not only anchors. Nothing in an offline document
 * resolves `//host` to anything useful, so that reach is accepted.
 *
 * This is DOMPurify's own default pattern (3.4.13) with one addition: the
 * leading negative lookahead refuses protocol-relative values, which the
 * default's `[^a-z]` branch would let through as "relative". DOMPurify tests
 * the value after stripping ASCII whitespace and controls, so `/\t/host` is
 * seen here as `//host` exactly as {@link isAllowedLinkHref} sees it via
 * parserView. The parity between the two is pinned in link-href.test.ts, and
 * so is the "default plus lookahead" claim — against the installed DOMPurify,
 * so a bump that changes the upstream scheme list fails a test instead of
 * silently making this comment false.
 */
export const SANITIZER_ALLOWED_URI_REGEXP =
  /^(?![/\\]{2})(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i;
