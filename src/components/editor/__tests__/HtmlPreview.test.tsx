// §5.1 The host half of the preview bridge.
//
// Everything arriving over postMessage is page-controlled — the previewed document is
// arbitrary HTML the bridge runs inside — so these are the checks that decide whether a
// page can make the app open a URL, and which window is allowed to ask.

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string, protocol = "asset") =>
    `${protocol}://localhost/${encodeURIComponent(path)}`,
  // The settings store persists through Tauri config IPC; without this every
  // zoom write logs a failure loud enough to bury the assertions.
  invoke: vi.fn().mockResolvedValue(null),
}));

const openUrlMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));

import { useSettingsStore } from "../../../stores/settings/store";
import { BRIDGE_TAG } from "../html-preview-url";
import { HtmlPreview } from "../HtmlPreview";

function renderPreview(active = true) {
  const view = render(
    <HtmlPreview active={active} filePath="/Users/me/a.html" />,
  );
  const { container } = view;
  const frame = container.querySelector("iframe");
  if (!frame) throw new Error("preview rendered no iframe");
  return {
    frame,
    /** Delivers a message as some window on the page. */
    post: (data: unknown, source: null | Window = frame.contentWindow) =>
      window.dispatchEvent(new MessageEvent("message", { data, source })),
    /** Re-renders with a different `active`, as a tab switch does. */
    setActive: (next: boolean) =>
      view.rerender(<HtmlPreview active={next} filePath="/Users/me/a.html" />),
  };
}

const openExternal = (url: unknown) => ({
  __baram: BRIDGE_TAG,
  type: "open-external",
  url,
});

beforeEach(() => {
  openUrlMock.mockClear();
  useSettingsStore.getState().setZoomLevel(1);
});

describe("external link requests", () => {
  it("opens an http(s) URL the preview frame asks for", () => {
    const { post } = renderPreview();
    post(openExternal("https://example.com/docs"));
    expect(openUrlMock).toHaveBeenCalledWith("https://example.com/docs");
  });

  /** The frame's origin is the string "null", and so is every other sandboxed
   *  frame's — identity has to come from the window reference, which page content
   *  cannot forge. */
  it("ignores the same request from any other window", () => {
    const { post } = renderPreview();
    post(openExternal("https://example.com/"), window);
    post(openExternal("https://example.com/"), null);
    expect(openUrlMock).not.toHaveBeenCalled();
  });

  it("refuses every scheme that is an instruction rather than a page", () => {
    const { post } = renderPreview();
    for (const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "vscode://file/etc/hosts",
      "mailto:a@b.c",
      42,
      null,
    ]) {
      post(openExternal(url));
    }
    expect(openUrlMock).not.toHaveBeenCalled();
  });

  it("ignores messages that are not the bridge's", () => {
    const { post } = renderPreview();
    post({ type: "open-external", url: "https://example.com/" });
    post({
      __baram: "something-else",
      type: "open-external",
      url: "https://example.com/",
    });
    post("open https://example.com/");
    post(null);
    expect(openUrlMock).not.toHaveBeenCalled();
  });
});

describe("zoom requests", () => {
  it("drives the shared zoom level, which the frame cannot reach on its own", () => {
    const { post } = renderPreview();
    const zoom = (action: string, delta = 0) =>
      post({ __baram: BRIDGE_TAG, action, delta, type: "zoom" });

    zoom("in");
    expect(useSettingsStore.getState().zoomLevel).toBeCloseTo(1.1);
    zoom("out");
    zoom("out");
    expect(useSettingsStore.getState().zoomLevel).toBeCloseTo(0.9);
    zoom("delta", -100);
    expect(useSettingsStore.getState().zoomLevel).toBeGreaterThan(0.9);
    zoom("reset");
    expect(useSettingsStore.getState().zoomLevel).toBe(1);
  });

  it("ignores a zoom request from another window", () => {
    const { post } = renderPreview();
    post({ __baram: BRIDGE_TAG, action: "in", delta: 0, type: "zoom" }, window);
    expect(useSettingsStore.getState().zoomLevel).toBe(1);
  });
});

describe("zoom painting", () => {
  /** The host paints by scaling the frame, so the level reaches the pixels through
   *  CSS rather than a postMessage round trip. `zoom` on the document root — the
   *  first cut — shrank its layout viewport by the same factor, so a fluid page
   *  reflowed to fill the frame again and a 10% step read as far less. */
  it("carries the level to CSS instead of sending it into the frame", () => {
    const { frame } = renderPreview();
    expect(frame.style.getPropertyValue("--preview-zoom")).toBe("1");

    act(() => {
      useSettingsStore.getState().setZoomLevel(1.5);
    });
    expect(frame.style.getPropertyValue("--preview-zoom")).toBe("1.5");
  });

  /** Nothing is sent down, so there is no handshake for a slow or bridge-less
   *  document to miss — zoom must not depend on the injected script at all. */
  it("never posts into the frame", () => {
    const { frame } = renderPreview();
    const contentWindow = frame.contentWindow;
    if (!contentWindow) throw new Error("frame has no contentWindow");
    const postMessage = vi.spyOn(contentWindow, "postMessage");

    act(() => {
      useSettingsStore.getState().setZoomLevel(1.4);
    });
    expect(postMessage).not.toHaveBeenCalled();
  });
});

describe("frame element", () => {
  /** allow-same-origin would hand the previewed page the app's own origin, and with
   *  it the parent document and the Tauri bridge. */
  it("stays sandboxed without allow-same-origin", () => {
    const { frame } = renderPreview();
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  });

  it("loads through the preview scheme, with separators intact", () => {
    const { frame } = renderPreview();
    expect(frame.getAttribute("src")).toBe(
      "baramhtml://localhost/Users/me/a.html",
    );
  });
});

// §288 규칙 1 — 이 iframe은 sandbox="allow-scripts"라 **숨어 있어도 스크립트가 돈다**
// (display:none 아래에서 rAF는 멎지만 setInterval은 산다). §286 유지 집합이 프리뷰를
// 마운트한 채로 두면, 지금까지 언마운트가 우연히 막아 주던 것이 사라진다: 백그라운드 HTML
// 파일이 사용자가 다른 탭을 보는 동안 앱 줌을 바꾸거나 브라우저를 띄울 수 있다.
describe("a hidden preview is muted", () => {
  const zoomIn = { __baram: BRIDGE_TAG, action: "in", type: "zoom" };

  it("applies zoom from its own frame while visible", () => {
    // 대조군. 이게 없으면 아래 단정은 "메시지가 애초에 도착하지 않았다"와 구분되지 않는다.
    const { post } = renderPreview(true);
    const before = useSettingsStore.getState().zoomLevel;
    act(() => post(zoomIn));
    expect(useSettingsStore.getState().zoomLevel).not.toBe(before);
  });

  it("ignores the very same message while hidden", () => {
    const { post } = renderPreview(false);
    const before = useSettingsStore.getState().zoomLevel;
    act(() => post(zoomIn));
    expect(useSettingsStore.getState().zoomLevel).toBe(before);
  });

  it("ignores an external-link request while hidden", () => {
    const { post } = renderPreview(false);
    act(() => post(openExternal("https://example.com")));
    expect(openUrlMock).not.toHaveBeenCalled();
  });
});

// §291 The preview's vertical scroll lives inside the frame's document, which is
// opaque-origin: the host can neither read nor write it. Hiding the surface destroys
// that document's layout box and the reader's place with it, so the position has to
// travel over the bridge in both directions.
describe("scroll position round trip", () => {
  it("hands the frame back the last position it reported", () => {
    const { frame, post, setActive } = renderPreview(true);
    const send = vi.fn();
    Object.defineProperty(frame.contentWindow, "postMessage", { value: send });

    act(() => post({ __baram: BRIDGE_TAG, type: "scroll", y: 880 }));
    act(() => setActive(false));
    act(() => setActive(true));

    expect(send).toHaveBeenCalledWith(
      { __baram: BRIDGE_TAG, type: "restore-scroll", y: 880 },
      "*",
    );
  });

  it("does not send a restore for a position of zero", () => {
    // 문서를 처음 열었을 때도 이 effect가 돈다. 0을 쏘면 문서 자신의 #fragment 앵커
    // 스크롤을 덮어쓴다.
    const { frame } = renderPreview(true);
    const send = vi.fn();
    Object.defineProperty(frame.contentWindow, "postMessage", { value: send });
    act(() => undefined);
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores a scroll report from a window that is not its frame", () => {
    const { frame, post, setActive } = renderPreview(true);
    const send = vi.fn();
    Object.defineProperty(frame.contentWindow, "postMessage", { value: send });

    act(() => post({ __baram: BRIDGE_TAG, type: "scroll", y: 999 }, window));
    act(() => setActive(false));
    act(() => setActive(true));
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores a scroll report with a non-numeric position", () => {
    const { frame, post, setActive } = renderPreview(true);
    const send = vi.fn();
    Object.defineProperty(frame.contentWindow, "postMessage", { value: send });

    act(() => post({ __baram: BRIDGE_TAG, type: "scroll", y: "880" }));
    act(() => setActive(false));
    act(() => setActive(true));
    expect(send).not.toHaveBeenCalled();
  });
});

// §291 상한(RETENTION_CAPS.html = 2)을 넘겨 축출된 탭은 다시 열릴 때 문서를 새로 로드한다.
// 그때도 자리는 남아야 한다 — 상한은 "재로딩을 얼마나 피할 것인가"의 문제여야지 "자리를
// 잃느냐"의 문제여서는 안 된다.
describe("position outlives the component", () => {
  it("reads its position from the caller's store, not its own lifetime", () => {
    const offsets = new Map<string, number>([["t1", 640]]);
    const { container } = render(
      <HtmlPreview
        active
        filePath="/Users/me/a.html"
        getScrollY={() => offsets.get("t1") ?? 0}
        onScrollY={(y) => offsets.set("t1", y)}
      />,
    );
    const frame = container.querySelector("iframe");
    const send = vi.fn();
    Object.defineProperty(frame!.contentWindow, "postMessage", { value: send });

    // 새로 열린 문서는 로드를 마쳐야 받을 준비가 된다.
    act(() => frame!.dispatchEvent(new Event("load")));
    expect(send).toHaveBeenCalledWith(
      { __baram: BRIDGE_TAG, type: "restore-scroll", y: 640 },
      "*",
    );
  });

  it("writes every reported position out to the caller's store", () => {
    const offsets = new Map<string, number>();
    const { container } = render(
      <HtmlPreview
        active
        filePath="/Users/me/a.html"
        getScrollY={() => offsets.get("t1") ?? 0}
        onScrollY={(y) => offsets.set("t1", y)}
      />,
    );
    const frame = container.querySelector("iframe");
    act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { __baram: BRIDGE_TAG, type: "scroll", y: 921 },
          source: frame!.contentWindow,
        }),
      ),
    );
    expect(offsets.get("t1")).toBe(921);
  });
});
