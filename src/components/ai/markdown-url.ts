// §backlog #8 — URL scheme allowlist for parsed markdown links/images in AI chat.
// AI responses (or prompt-injected content) could contain `javascript:` /
// `vbscript:` / `data:text/html` URLs that execute in the Tauri webview and
// reach the IPC bridge, so anything not matching this pattern is neutralized.
//
// The prefix pattern is the chat's own, narrower scheme set (http, https,
// mailto, tel, fragments, rooted or dot-relative paths). It is ANDed with the
// app-wide link policy (link-href.ts, issue 499) because a prefix test cannot
// see what the browser's URL parser sees: its `/` branch let a
// protocol-relative `//host` through (issue 527), a tab or newline inside the
// scheme hides `java\tscript:` from it, and a value the parser rejects
// (`http://[`) should fail closed rather than pass on its first bytes.
import { isAllowedLinkHref } from "../../utils/link-href";

const SAFE_URL_RE = /^(https?:|mailto:|tel:|#|\/|\.\.?\/)/i;

function isSafeChatUrl(url: string): boolean {
  const u = url.trim();
  return SAFE_URL_RE.test(u) && isAllowedLinkHref(u);
}

/** Return the src only for safe schemes (incl. inline `data:image/*`), else empty. */
export function safeImageSrc(url: string): string {
  return isSafeChatUrl(url) || /^data:image\//i.test(url.trim()) ? url : "";
}

/** Return the href only if it uses a safe scheme, else a harmless anchor. */
export function safeLinkHref(url: string): string {
  return isSafeChatUrl(url) ? url : "#";
}
