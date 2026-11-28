// HTML file preview — renders the saved .html file in a sandboxed iframe.
// The file is loaded through the `baramhtml:` scheme as its own document (own
// origin, no app-CSP inheritance), so the page's inline/external scripts run and
// relative assets resolve. sandbox="allow-scripts" WITHOUT allow-same-origin
// keeps the document in an opaque origin: it can mutate its own DOM, but can
// never reach the host webview, the parent document, or the Tauri IPC bridge.
//
// Zoom is painted HERE, by scaling the frame (see html-preview.css) — the host
// owns the pixels and the document is never restyled. The bridge inside the frame
// forwards zoom INPUT and never a level, so the level never makes a round trip to
// be applied: it lands in the same commit as any other zoom in the app, and it
// still lands in a document whose bridge is gone.
//
// The containment cuts both ways — the host cannot read the document, and the
// document's clicks and keystrokes never reach the host's listeners. So the
// protocol handler injects a bridge (html-preview-shim.js) that posts out the four
// things the preview needs — the four `case`s of the message handler below:
//
//   external links  the frame must not navigate to a remote page, so http/https
//                   anchors are handed to the system browser instead
//   zoom input      Cmd+= / Cmd+- / Cmd+0 and Ctrl+wheel die inside the frame
//                   once it has focus; forwarded, they drive the shared level
//   scroll position §291 the frame's own vertical position, the one the host hands
//                   back when the frame has lost it
//   loaded          §291 a new document is in the frame — one of the two moments it
//                   has lost its place (see `restore`)
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
  // getScrollY도 같은 이유로 미러링한다 — 그리고 여기서는 비용이 아니라 **동작**이다. 이걸
  // deps로 받으면 `restore`의 정체성이 렌더마다 바뀌어 아래 "다시 보이게 될 때" effect가 앱의
  // 아무 재렌더에나 다시 돌고, 문서가 방금 간 곳을 마지막 보고 위치로 당긴다.
  const getScrollYRef = useRef(getScrollY);
  getScrollYRef.current = getScrollY;
  const zoomLevel = useSettingsStore((s) => s.zoomLevel);
  const src = useMemo(
    () => htmlPreviewUrl(filePath, refreshKey),
    [filePath, refreshKey],
  );

  // §291 프레임에 위치를 돌려준다.
  //
  // 프레임이 자리를 **잃은** 두 순간을 위해 있다. 그 밖의 시점에 부르면 문서가 방금 간 곳을
  // 마지막 보고 위치로 되돌린다 — 보고는 shim이 rAF로 한 프레임 미루므로, 이동 직후에 부르면
  // 그 값은 이동 전 위치다.
  //
  //   다시 보이게 될 때   마운트는 유지된 채 숨었다 나온 경우. 숨겨질 때 레이아웃 박스가
  //                       파기되어 위치가 0으로 돌아간다(아래 effect)
  //   새 문서가 떴을 때   상한을 넘겨 축출됐다가 다시 열렸거나, 저장으로 다시 로드된 경우.
  //                       로드가 끝났다는 사실은 문서가 `loaded`로 알린다(아래 message 핸들러)
  //
  // ‼️ 둘째 경로는 그 두 경우보다 넓다. 페이지가 스스로 다른 문서로 간 경우(형제 파일로 가는
  // `baramhtml:` 링크, `location.reload()`)도 `loaded`를 알리고, 그 문서도 이 탭의 마지막
  // 위치를 받는다. 이 판정을 `<iframe onLoad>`가 하던 때와 같은 동작이다.
  //
  // ‼️ `<iframe onLoad>`로 "새 문서"를 판정하지 말 것. 요소의 `load`만으로는 새 문서와 같은
  // 문서 안 이동을 가를 수 없다 — WKWebView는 프레임 안에서 `#fragment`로 이동할 때마다 iframe
  // 요소에 `load`를 다시 쏜다(측정 조건은 html-preview-shim.js의 `loaded` 주석). 그걸 새 문서로
  // 읽었을 때 문서 안 링크가 첫 번째만 동작했다 — 첫 이동은 저장값이 0이라 건너뛰고, 그 뒤
  // 이동은 전부 첫 이동 위치로 되돌아갔다. opaque origin이라 호스트는 프레임의 URL도 읽지 못한다.
  //
  // 되돌릴 값이 0이면 보내지 않는다. 되돌릴 자리가 없고, `loaded`를 알린 새 문서는 자기
  // `#fragment` 앵커로 이미 스크롤했을 수 있다 — 그때 0을 쏘면 그 스크롤을 덮어쓴다.
  const restore = useCallback(() => {
    const read = getScrollYRef.current;
    const y = read ? read() : scrollYRef.current;
    if (y <= 0) return;
    frameRef.current?.contentWindow?.postMessage(
      { __baram: BRIDGE_TAG, type: "restore-scroll", y },
      "*",
    );
  }, []);

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
        // §291 프레임에 새 문서가 떴다(경우는 `restore` 주석). 이 문서는 아무 위치도 받지
        // 못한 채 떴다 — 축출 뒤 다시 열린 경우 마운트 때의 복원은 그 파일이 뜨기 전의 초기
        // about:blank 문서로 갔고, 보이는 동안 저장으로 다시 로드된 경우는 보내 준 적이 없다.
        case "loaded":
          restore();
          return;
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
  }, [active, restore]);

  // 다시 보이게 되면 프레임에 위치를 돌려준다.
  //
  // 숨겨질 때 이 문서의 레이아웃 박스가 파기되어 위치가 0으로 돌아가므로, 살아 있는 것은
  // 우리가 받아 둔 마지막 보고뿐이다. `restore`가 렌더마다 같은 함수이므로 이 effect는 마운트와
  // `active`가 바뀔 때만 돈다 — 보이는 동안의 재렌더에는 돌지 않는다.
  useEffect(() => {
    if (!active) return;
    restore();
  }, [active, restore]);

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
