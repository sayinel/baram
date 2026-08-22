// §296 fullscreen button — jsdom has no real Fullscreen API, so these pin the
// two behaviours that are actually unit-testable: (1) support detection reads
// `fullscreenEnabled` (with the WebKit-prefixed fallback), NOT method
// presence, and (2) requesting prefers the standard method over the legacy
// prefixed one and no-ops when neither exists. Whether calling the real
// method actually enters fullscreen in a live WKWebView is not observable
// here — see utils/fullscreen.ts's own comment for why.
import { describe, expect, it, vi } from "vitest";

import { isFullscreenSupported, requestVideoFullscreen } from "../fullscreen";

describe("isFullscreenSupported", () => {
  it("is true when document.fullscreenEnabled is true", () => {
    const doc = { fullscreenEnabled: true } as unknown as Document;
    expect(isFullscreenSupported(doc)).toBe(true);
  });

  it("is false when document.fullscreenEnabled is false and there is no WebKit fallback", () => {
    const doc = { fullscreenEnabled: false } as unknown as Document;
    expect(isFullscreenSupported(doc)).toBe(false);
  });

  // The exact case this app hits today: src-tauri's Cargo.toml previously did
  // not enable the `macos-private-api` feature, so WKWebView never set the
  // private `fullScreenEnabled` WKPreferences key — `requestFullscreen`
  // exists as a method the whole time, but `fullscreenEnabled` reports false.
  it("falls back to the WebKit-prefixed flag when the standard one is false", () => {
    const doc = {
      fullscreenEnabled: false,
      webkitFullscreenEnabled: true,
    } as unknown as Document;
    expect(isFullscreenSupported(doc)).toBe(true);
  });
});

describe("requestVideoFullscreen", () => {
  it("calls the standard requestFullscreen when present", () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const el = { requestFullscreen } as unknown as HTMLVideoElement;
    requestVideoFullscreen(el);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it("prefers the standard method over the WebKit-prefixed one when both exist", () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const webkitRequestFullscreen = vi.fn();
    const el = {
      requestFullscreen,
      webkitRequestFullscreen,
    } as unknown as HTMLVideoElement;
    requestVideoFullscreen(el);
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(webkitRequestFullscreen).not.toHaveBeenCalled();
  });

  it("falls back to the WebKit-prefixed method when the standard one is missing", () => {
    const webkitRequestFullscreen = vi.fn();
    const el = { webkitRequestFullscreen } as unknown as HTMLVideoElement;
    requestVideoFullscreen(el);
    expect(webkitRequestFullscreen).toHaveBeenCalledTimes(1);
  });

  it("no-ops without throwing when neither method exists", () => {
    const el = {} as HTMLVideoElement;
    expect(() => requestVideoFullscreen(el)).not.toThrow();
  });
});
