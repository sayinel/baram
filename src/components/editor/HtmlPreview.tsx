// HTML file preview — renders the saved .html file in a sandboxed iframe.
// The file is loaded through the `baramhtml:` scheme as its own document (own
// origin, no app-CSP inheritance), so the page's inline/external scripts run and
// relative assets resolve. sandbox="allow-scripts" WITHOUT allow-same-origin
// keeps the document in an opaque origin: it can mutate its own DOM, but can
// never reach the host webview, the parent document, or the Tauri IPC bridge.
//
// Zoom is painted HERE, by scaling the frame (see html-preview.css) — the host
// owns the pixels and the document is never restyled. The bridge inside the frame
// forwards zoom INPUT and nothing else, so the level never makes a round trip to
// be applied: it lands in the same commit as any other zoom in the app, and it
// still lands in a document whose bridge is gone.
//
// The containment cuts both ways — the host cannot read the document, and the
// document's clicks and keystrokes never reach the host's listeners. So the
// protocol handler injects a bridge (html-preview-shim.js) that posts out the two
// things the preview needs:
//
//   external links  the frame must not navigate to a remote page, so http/https
//                   anchors are handed to the system browser instead
//   zoom input      Cmd+= / Cmd+- / Cmd+0 and Ctrl+wheel die inside the frame
//                   once it has focus; forwarded, they drive the shared level
//
// Everything arriving from the bridge is page-controlled input and is re-checked
// here — see `externalUrlToOpen`.

import type { CSSProperties } from "react";
import { memo, useEffect, useMemo, useRef } from "react";

import { openUrl } from "@tauri-apps/plugin-opener";

import { zoomByWheel, zoomIn, zoomOut, zoomReset } from "../../hooks/use-zoom";
import { useSettingsStore } from "../../stores/settings/store";
import { logger } from "../../utils/logger";
import {
  BRIDGE_TAG,
  externalUrlToOpen,
  htmlPreviewUrl,
} from "./html-preview-url";

interface HtmlPreviewProps {
  /**
   * §288 규칙 1 — 이 프리뷰가 지금 화면에 보이는가. 기본값 true.
   *
   * 보이지 않는 동안 브릿지 메시지를 처리하지 않는다. 이유는 아래 effect의 주석 참조.
   */
  active?: boolean;
  /** Absolute path of the .html file (must be inside an opened context). */
  filePath: string;
  /** Bumped on every save — forces the iframe to reload the file from disk. */
  refreshKey?: number;
  /** Accessible title for the iframe (file path or name). */
  title?: string;
}

export const HtmlPreview = memo(function HtmlPreview({
  active = true,
  filePath,
  refreshKey,
  title,
}: HtmlPreviewProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const zoomLevel = useSettingsStore((s) => s.zoomLevel);
  const src = useMemo(
    () => htmlPreviewUrl(filePath, refreshKey),
    [filePath, refreshKey],
  );

  useEffect(() => {
    // §288 규칙 1 — 보안 사안이다. 이 iframe은 sandbox="allow-scripts"라 숨어 있어도
    // 스크립트가 돈다(display:none 아래에서 rAF는 멎지만 setInterval은 산다). 핸들러를
    // 그대로 두면 백그라운드 HTML 파일이 사용자가 다른 탭을 보는 동안 `zoom`으로 앱 줌을
    // 바꾸거나 `open-external`로 브라우저를 띄울 수 있다. 지금까지는 언마운트가 우연히
    // 이걸 막고 있었고, 마운트를 유지하는 순간 그 방어가 사라진다.
    if (!active) return;
    const handleMessage = (event: MessageEvent) => {
      // Identity comes from the window object, not the origin: an opaque-origin
      // frame reports its origin as the string "null", which every other
      // sandboxed frame on the page reports too. The window reference cannot be
      // forged by page content.
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;

      const message: unknown = event.data;
      if (typeof message !== "object" || message === null) return;
      const payload = message as Record<string, unknown>;
      if (payload.__baram !== BRIDGE_TAG) return;

      switch (payload.type) {
        case "open-external": {
          const url = externalUrlToOpen(payload.url);
          if (!url) return;
          openUrl(url).catch((err) =>
            logger.warn("[HtmlPreview] openUrl failed:", err),
          );
          return;
        }
        case "zoom":
          applyZoomAction(payload.action, payload.delta);
          return;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [active]);

  return (
    <iframe
      className="html-preview-frame"
      ref={frameRef}
      sandbox="allow-scripts"
      src={src}
      style={{ "--preview-zoom": zoomLevel } as CSSProperties}
      title={title || "HTML preview"}
    />
  );
});

function applyZoomAction(action: unknown, delta: unknown): void {
  switch (action) {
    case "delta":
      if (typeof delta === "number") zoomByWheel(delta);
      return;
    case "in":
      zoomIn();
      return;
    case "out":
      zoomOut();
      return;
    case "reset":
      zoomReset();
      return;
  }
}
