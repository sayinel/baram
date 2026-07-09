// §backlog #8 — URL scheme allowlist for parsed markdown links/images in AI chat.
// AI responses (or prompt-injected content) could contain `javascript:` /
// `vbscript:` / `data:text/html` URLs that execute in the Tauri webview and
// reach the IPC bridge, so anything not matching this pattern is neutralized.
const SAFE_URL_RE = /^(https?:|mailto:|tel:|#|\/|\.\.?\/)/i;

/** Return the src only for safe schemes (incl. inline `data:image/*`), else empty. */
export function safeImageSrc(url: string): string {
  const u = url.trim();
  return SAFE_URL_RE.test(u) || /^data:image\//i.test(u) ? url : "";
}

/** Return the href only if it uses a safe scheme, else a harmless anchor. */
export function safeLinkHref(url: string): string {
  return SAFE_URL_RE.test(url.trim()) ? url : "#";
}
