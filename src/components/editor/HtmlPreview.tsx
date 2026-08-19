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
import { memo, useCallback, useEffect, useMemo, useRef } from "react";

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
  /**
   * §291 이 탭의 마지막 위치를 읽고 쓴다. **컴포넌트 밖에 산다** — 상한을 넘겨 축출되면
   * 이 컴포넌트는 사라지지만 자리는 남아야 한다. 생략하면 컴포넌트 수명만큼만 기억한다.
   */
  getScrollY?: () => number;
  onScrollY?: (y: number) => void;
  /** Bumped on every save — forces the iframe to reload the file from disk. */
  refreshKey?: number;
  /** Accessible title for the iframe (file path or name). */
  title?: string;
}

export const HtmlPreview = memo(function HtmlPreview({
  active = true,
  filePath,
  getScrollY,
  onScrollY,
  refreshKey,
  title,
}: HtmlPreviewProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  /**
   * §291 프레임이 마지막으로 알려 온 세로 위치.
   *
   * ‼️ 호스트가 직접 잴 수 없다. 래퍼는 `overflow: auto hidden`이라 세로로 스크롤하지 않고,
   * 실제 스크롤은 opaque-origin 중첩 문서 안에 있다. 그래서 값은 bridge로만 들어온다.
   */
  const scrollYRef = useRef(0);
  // 호출부가 인라인으로 만드는 콜백이라 매 렌더 참조가 바뀐다. deps에 넣으면 그때마다
  // 리스너를 다시 달게 되므로 ref로 미러링한다(use-tab-scroll-memory.ts와 같은 이유).
  const onScrollYRef = useRef(onScrollY);
  onScrollYRef.current = onScrollY;
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
        // §291 프레임이 자기 스크롤 위치를 알려 온다. 우리는 이 문서의 scrollTop을 읽을 수
        // 없으므로(opaque origin) 이것이 유일한 출처다.
        case "scroll":
          if (typeof payload.y !== "number") return;
          scrollYRef.current = payload.y;
          onScrollYRef.current?.(payload.y);
          return;
        case "zoom":
          applyZoomAction(payload.action, payload.delta);
          return;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [active]);

  // §291 프레임에 위치를 돌려준다.
  //
  // 두 시점에서 부른다: 다시 **보이게 될 때**(마운트는 유지된 채 숨었다 나온 경우)와 프레임이
  // **로드를 마쳤을 때**(상한을 넘겨 축출됐다가 다시 열린 경우 — 그때는 문서가 새로 뜨므로
  // 보이게 되는 시점엔 아직 받을 문서가 없다).
  const restore = useCallback(() => {
    const y = getScrollY ? getScrollY() : scrollYRef.current;
    if (y <= 0) return;
    frameRef.current?.contentWindow?.postMessage(
      { __baram: BRIDGE_TAG, type: "restore-scroll", y },
      "*",
    );
  }, [getScrollY]);

  // 다시 보이게 되면 프레임에 위치를 돌려준다.
  //
  // 숨겨질 때 이 문서의 레이아웃 박스가 파기되어 위치가 0으로 돌아가므로, 살아 있는 것은
  // 우리가 받아 둔 마지막 보고뿐이다. 되돌릴 값이 0이면 보내지 않는다 — 프레임은 이미 거기
  // 있고, 문서를 새로 연 직후에도 이 effect가 도는데 그때 0을 쏘면 문서 자신의 `#fragment`
  // 앵커 스크롤을 덮어쓴다.
  useEffect(() => {
    if (!active) return;
    restore();
  }, [active, restore]);

  return (
    <iframe
      className="html-preview-frame"
      onLoad={restore}
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
