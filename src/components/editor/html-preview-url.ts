// §5.1 Preview URLs for the `baramhtml:` scheme (src-tauri/src/protocol/html_preview.rs).
//
// Deliberately NOT `convertFileSrc(path, "baramhtml")`: that percent-encodes the whole
// path into one opaque URL segment, and a document served from a single segment has no
// directory for its relative references to resolve against — `img/a.png` inside the
// document would resolve to `/img/a.png` and 403. Real path segments are the entire
// point of the scheme, so the segments are encoded and the separators are not.
//
// The origin form is platform-dependent (`baramhtml://localhost` on macOS and Linux,
// `http://baramhtml.localhost` on Windows). It is read back out of convertFileSrc
// rather than rebuilt here: one place in the app knows which platform it is on, and
// duplicating that knowledge is how the two drift.

import { convertFileSrc } from "@tauri-apps/api/core";

/** Must match `SCHEME` in src-tauri/src/protocol/html_preview.rs. */
const SCHEME = "baramhtml";

/** Message tag shared with src-tauri/src/protocol/html-preview-shim.js. */
export const BRIDGE_TAG = "baram:html-preview";

/**
 * The URL a link click inside the preview is allowed to open, or null.
 *
 * The bridge already filters, but it runs inside the previewed document and is
 * therefore attacker-controlled input: a page can post whatever it likes. This is the
 * check that counts. http/https only — `file:`, `javascript:` and custom schemes hand
 * the OS an instruction rather than a page to read.
 */
export function externalUrlToOpen(value: unknown): null | string {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.protocol === "http:" || url.protocol === "https:"
    ? url.href
    : null;
}

/**
 * Absolute preview URL for a file.
 *
 * @param refreshKey Bumped on every save — a cache-buster the protocol handler ignores,
 *   so it only ever forces the webview to re-fetch.
 */
export function htmlPreviewUrl(filePath: string, refreshKey?: number): string {
  const origin = convertFileSrc("", SCHEME).replace(/\/+$/, "");
  const path = filePath
    // Windows paths arrive with backslashes; the URL wants separators either way.
    .replace(/\\/g, "/")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  const url = path.startsWith("/") ? `${origin}${path}` : `${origin}/${path}`;
  return refreshKey ? `${url}?v=${refreshKey}` : url;
}
