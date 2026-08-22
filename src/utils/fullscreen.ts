// §296 fullscreen button — macOS WKWebView gates the standard Fullscreen API
// behind a private WKPreferences key (`fullScreenEnabled`) that wry (Tauri's
// webview crate) only sets when the `fullscreen` cargo feature is on, which
// in turn only ships when Tauri's `macos-private-api` feature is enabled
// (tauri-runtime-wry 2.11.4's Cargo.toml: `macos-private-api = ["wry/fullscreen",
// ...]`). `HTMLVideoElement.prototype.requestFullscreen` EXISTS either way —
// only `document.fullscreenEnabled` tells the truth about whether calling it
// will actually do anything. Checking method presence alone would render a
// button that silently no-ops, which is worse than no button.

interface FullscreenDocument extends Document {
  webkitFullscreenEnabled?: boolean;
}

interface FullscreenVideoElement extends HTMLVideoElement {
  webkitRequestFullscreen?: () => void;
}

/** True only if entering fullscreen from this document can actually work. */
export function isFullscreenSupported(doc: Document = document): boolean {
  const d = doc as FullscreenDocument;
  return Boolean(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

/** Requests fullscreen on `el`, preferring the standard API over the legacy
 * WebKit-prefixed one. No-ops if neither is present — callers should gate
 * rendering the trigger on {@link isFullscreenSupported} first. */
export function requestVideoFullscreen(el: HTMLVideoElement): void {
  const video = el as FullscreenVideoElement;
  if (typeof video.requestFullscreen === "function") {
    void video.requestFullscreen();
  } else if (typeof video.webkitRequestFullscreen === "function") {
    video.webkitRequestFullscreen();
  }
}
