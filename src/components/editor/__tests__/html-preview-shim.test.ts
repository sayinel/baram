// §5.1 The bridge injected into every previewed HTML document
// (src-tauri/src/protocol/html-preview-shim.js).
//
// The source under test is the exact file the Rust handler splices into documents —
// read from disk rather than re-declared here, so a change to one without the other
// turns this suite red instead of shipping a preview whose links do nothing.
//
// It is evaluated with `window` and `document` passed in as parameters, which is what
// lets the parent window be a stand-in: the shim reads both off its scope, so the real
// jsdom document still handles the anchors and event dispatch while `window.parent`
// becomes an observable endpoint. Everything asserted here is a decision the shim
// makes — which hrefs it takes over, which keys it forwards, what it refuses.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const SHIM_SOURCE = readFileSync(
  resolve(__dirname, "../../../../src-tauri/src/protocol/html-preview-shim.js"),
  "utf8",
);

const TAG = "baram:html-preview";

/** What the frame's document is actually served from — see html-preview-url.ts. */
const DOC_URL = "baramhtml://localhost/Users/me/docs/index.html";

interface Harness {
  click: (selector: string, init?: MouseEventInit) => { prevented: boolean };
  doc: Document;
  fire: (type: string, event: unknown) => void;
  /** Runs the callbacks the shim queued for the next frame. */
  flushFrame: () => void;
  key: (init: KeyboardEventInit) => { prevented: boolean };
  /** Delivers a postMessage as either the host window or some other window. */
  message: (data: unknown, from: "other" | "parent") => void;
  open: (url?: string) => unknown;
  parent: object;
  posted: Record<string, unknown>[];
  /** The options the shim last passed to scrollTo, or null. */
  scrollCall: () => null | Record<string, unknown>;
  /** The (x, y) the shim last asked the document to scroll to, or null. */
  scrolledTo: () => [number, number] | null;
  setScrollY: (y: number) => void;
}

/**
 * Installs the shim over a document of its own.
 *
 * Its own, and not the suite's: the shim registers document listeners it has no way to
 * remove, so a shared document would leave every earlier test's copy running. They
 * `preventDefault()` first and the copy under test then reads its own event as already
 * handled — which reads as "the shim ignored this link" and is not.
 *
 * The `<base>` matters as much. Under jsdom a document's base is `http://localhost/`,
 * where every relative href resolves to http and the shim would claim the lot. The real
 * frame is served over `baramhtml:`, and that is what decides which links are external.
 */
function mount(bodyHtml = ""): Harness {
  const doc = document.implementation.createHTMLDocument("preview");
  const base = doc.createElement("base");
  base.setAttribute("href", DOC_URL);
  doc.head.append(base);
  doc.body.innerHTML = bodyHtml;

  const posted: Record<string, unknown>[] = [];
  const windowListeners = new Map<string, ((event: unknown) => void)[]>();
  const parent = {
    postMessage: (message: Record<string, unknown>) =>
      void posted.push(message),
  };

  let scrolledTo: [number, number] | null = null;
  let scrollCall: null | Record<string, unknown> = null;
  // rAF is driven by hand so the coalescing below is observable rather than assumed.
  const frameQueue: (() => void)[] = [];
  const fakeWindow = {
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      const existing = windowListeners.get(type) ?? [];
      existing.push(handler);
      windowListeners.set(type, existing);
    },
    open: vi.fn(() => "native-window"),
    parent,
    requestAnimationFrame: (fn: () => void) => void frameQueue.push(fn),
    scrollTo: (arg: number | Record<string, unknown>, y?: number) => {
      if (typeof arg === "number") {
        scrolledTo = [arg, y ?? 0];
        scrollCall = { left: arg, top: y };
        return;
      }
      scrollCall = arg;
      scrolledTo = [Number(arg.left ?? 0), Number(arg.top ?? 0)];
    },
    scrollY: 0,
  };

  new Function("window", "document", SHIM_SOURCE)(fakeWindow, doc);

  return {
    click: (selector, init = {}) => {
      const target = doc.querySelector(selector);
      if (!target) throw new Error(`no element matches ${selector}`);
      const event = new MouseEvent("click", {
        bubbles: true,
        button: 0,
        cancelable: true,
        ...init,
      });
      target.dispatchEvent(event);
      return { prevented: event.defaultPrevented };
    },
    doc,
    fire: (type, event) => {
      for (const handler of windowListeners.get(type) ?? []) handler(event);
    },
    key: (init) => {
      const event = new KeyboardEvent("keydown", { cancelable: true, ...init });
      doc.dispatchEvent(event);
      return { prevented: event.defaultPrevented };
    },
    flushFrame: () => {
      const queued = frameQueue.splice(0, frameQueue.length);
      for (const fn of queued) fn();
    },
    message: (data, from) => {
      for (const handler of windowListeners.get("message") ?? []) {
        handler({ data, source: from === "parent" ? parent : {} });
      }
    },
    open: fakeWindow.open as (url?: string) => unknown,
    parent,
    posted,
    scrollCall: () => scrollCall,
    scrolledTo: () => scrolledTo,
    setScrollY: (y: number) => {
      fakeWindow.scrollY = y;
    },
  };
}

/** The harness has to be able to tell the two link outcomes apart at all. */
it("harness sanity: the document really is served over the preview scheme", () => {
  expect(mount().doc.baseURI).toBe(DOC_URL);
});

describe("bridge scope", () => {
  it("says nothing until the page does something", () => {
    const { posted } = mount("<p>hello</p>");
    expect(posted).toEqual([]);
  });
});

// §291 The one thing the frame DOES take from the host.
//
// ‼️ This bridge was deliberately one-way, and the reason it changed is worth keeping:
// the preview's vertical scroll lives in THIS document, not in the host's wrapper
// (`overflow: auto hidden` there). The host cannot read or write it — opaque origin —
// so retaining the surface across tab switches still lost the reader's place. The
// position has to travel over the bridge or not at all.
//
// The frame reports on scroll and accepts exactly one instruction back. Everything else
// from the host is refused, and the sender is checked by window identity rather than
// origin: every sandboxed frame reports its origin as the string "null".
describe("scroll position bridge", () => {
  it("reports the position when the document scrolls", () => {
    const { fire, flushFrame, posted, setScrollY } = mount("<p>hello</p>");
    setScrollY(742);
    fire("scroll", {});
    flushFrame();
    expect(posted.at(-1)).toEqual({ __baram: TAG, type: "scroll", y: 742 });
  });

  it("coalesces a burst of scroll events into one report per frame", () => {
    // ‼️ 이걸 단정하지 않으면 rAF는 그냥 지연일 뿐이다. 스크롤 한 번에 핸들러가 수십 번
    // 도는데, 메시지 하나하나가 프로세스 경계를 넘는 structured clone이다.
    const { fire, flushFrame, posted, setScrollY } = mount("<p>hello</p>");
    setScrollY(10);
    fire("scroll", {});
    setScrollY(20);
    fire("scroll", {});
    setScrollY(30);
    fire("scroll", {});
    flushFrame();
    const reports = posted.filter((m) => m.type === "scroll");
    expect(reports).toHaveLength(1);
    // 프레임 끝의 값을 보고한다 — 중간값이 아니라.
    expect(reports[0]?.y).toBe(30);
  });

  it("applies a restore instruction from the host", () => {
    const { message, scrolledTo } = mount("<p>hello</p>");
    message({ __baram: TAG, type: "restore-scroll", y: 512 }, "parent");
    expect(scrolledTo()).toEqual([0, 512]);
  });

  // ‼️ 실앱에서 **한 파일만** 깨졌다. 두 HTML의 차이가 정확히 하나였다:
  //
  //   hyperaccel_lpu_architecture.html   scroll-behavior: smooth  → 깨짐
  //   VJEPA2_AC_workload_analysis.html   (없음)                    → 정상
  //
  // `scroll-behavior: smooth`가 걸린 문서에서는 `scrollTo`가 **애니메이션**이 된다. 프레임이
  // 막 다시 보이며 레이아웃 박스가 재생성되는 순간에 시작된 애니메이션은 0에서 끊긴다.
  // 복원은 이동이 아니라 **되돌리기**이므로 애니메이션이면 안 된다 — 문서가 무엇을 선언했든.
  it("jumps instantly, so a document's smooth scroll-behavior cannot animate the restore", () => {
    const { message, scrollCall } = mount("<p>hello</p>");
    message({ __baram: TAG, type: "restore-scroll", y: 512 }, "parent");
    expect(scrollCall()).toMatchObject({ behavior: "instant", top: 512 });
  });

  it("refuses a restore from any window other than the host", () => {
    // A nested frame inside the previewed document must not be able to drive this.
    const { message, scrolledTo } = mount("<p>hello</p>");
    message({ __baram: TAG, type: "restore-scroll", y: 512 }, "other");
    expect(scrolledTo()).toBeNull();
  });

  it("refuses an untagged or non-numeric restore", () => {
    const { message, scrolledTo } = mount("<p>hello</p>");
    message({ type: "restore-scroll", y: 512 }, "parent");
    message({ __baram: TAG, type: "restore-scroll", y: "512" }, "parent");
    message({ __baram: TAG, type: "something-else", y: 512 }, "parent");
    expect(scrolledTo()).toBeNull();
  });
});

describe("external links", () => {
  it("hands an http(s) anchor to the host instead of navigating", () => {
    const { click, posted } = mount(
      '<a id="x" href="https://example.com/docs">go</a>',
    );
    expect(click("#x").prevented).toBe(true);
    expect(posted.at(-1)).toEqual({
      __baram: TAG,
      type: "open-external",
      url: "https://example.com/docs",
    });
  });

  /** `//host/path` means the network over the page's own scheme -- which here is
   *  `baramhtml:`, where resolving it that way can only 403. */
  it("reads a protocol-relative href as the network, not as this scheme", () => {
    const { click, posted } = mount('<a id="x" href=" //example.com/a">go</a>');
    expect(click("#x").prevented).toBe(true);
    expect(posted.at(-1)?.url).toBe("https://example.com/a");
  });

  it("finds the anchor from a nested click target", () => {
    const { click, posted } = mount(
      '<a href="https://example.com/"><span id="inner">go</span></a>',
    );
    expect(click("#inner").prevented).toBe(true);
    expect(posted.at(-1)?.type).toBe("open-external");
  });

  /** In-document anchors are the one link kind that already worked; taking them
   *  over would trade one broken case for another. */
  it("leaves fragment links to the document", () => {
    const { click, posted } = mount(
      '<a id="x" href="#section">go</a><h2 id="section">s</h2>',
    );
    expect(click("#x").prevented).toBe(false);
    expect(posted.some((m) => m.type === "open-external")).toBe(false);
  });

  it("leaves same-scheme links so page-to-page navigation still works", () => {
    const { click, posted } = mount('<a id="x" href="next.html">go</a>');
    expect(click("#x").prevented).toBe(false);
    expect(posted.some((m) => m.type === "open-external")).toBe(false);
  });

  it("leaves schemes that are an instruction rather than a page", () => {
    for (const href of ["mailto:a@b.c", "javascript:alert(1)", "tel:123"]) {
      const { click, posted } = mount(`<a id="x" href="${href}">go</a>`);
      expect(click("#x").prevented).toBe(false);
      expect(posted.some((m) => m.type === "open-external")).toBe(false);
    }
  });

  /** Cmd/Shift/middle-click carry an intent of their own; the sandbox denies them
   *  anyway, and claiming them would make the modifier look like it worked. */
  it("ignores modified and non-primary clicks", () => {
    const { click, posted } = mount(
      '<a id="x" href="https://example.com/">go</a>',
    );
    expect(click("#x", { metaKey: true }).prevented).toBe(false);
    expect(click("#x", { shiftKey: true }).prevented).toBe(false);
    expect(click("#x", { button: 1 }).prevented).toBe(false);
    expect(posted.some((m) => m.type === "open-external")).toBe(false);
  });

  it("ignores an anchor with no href at all", () => {
    const { click, posted } = mount('<a id="x">not a link</a>');
    expect(click("#x").prevented).toBe(false);
    expect(posted.some((m) => m.type === "open-external")).toBe(false);
  });

  it("routes window.open for http(s) and defers to the native one otherwise", () => {
    const { open, posted } = mount();

    expect(open("https://example.com/")).toBeNull();
    expect(posted.at(-1)).toEqual({
      __baram: TAG,
      type: "open-external",
      url: "https://example.com/",
    });

    expect(open("about:blank")).toBe("native-window");
  });
});

describe("zoom input forwarding", () => {
  it.each([
    ["=", "in"],
    ["+", "in"],
    ["-", "out"],
    ["_", "out"],
    ["0", "reset"],
  ])("forwards Cmd+%s as %s", (pressed, action) => {
    const { key, posted } = mount();
    expect(key({ key: pressed, metaKey: true }).prevented).toBe(true);
    expect(posted.at(-1)).toEqual({
      __baram: TAG,
      action,
      delta: 0,
      type: "zoom",
    });
  });

  it("accepts Ctrl as well as Cmd", () => {
    const { key, posted } = mount();
    expect(key({ ctrlKey: true, key: "=" }).prevented).toBe(true);
    expect(posted.at(-1)?.action).toBe("in");
  });

  it("ignores keys that are not zoom, and zoom keys without a modifier", () => {
    const { key, posted } = mount();
    expect(key({ key: "=", metaKey: false }).prevented).toBe(false);
    expect(key({ key: "s", metaKey: true }).prevented).toBe(false);
    // Alt+Cmd+- belongs to whatever else claims it, not to zoom.
    expect(key({ altKey: true, key: "-", metaKey: true }).prevented).toBe(
      false,
    );
    expect(posted.some((m) => m.type === "zoom")).toBe(false);
  });

  it("forwards a pinch (ctrl+wheel) with its delta, and ignores a plain scroll", () => {
    const { fire, posted } = mount();
    const preventDefault = vi.fn();

    fire("wheel", { ctrlKey: true, deltaY: -42, preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(posted.at(-1)).toEqual({
      __baram: TAG,
      action: "delta",
      delta: -42,
      type: "zoom",
    });

    fire("wheel", { ctrlKey: false, deltaY: 10, preventDefault: vi.fn() });
    expect(posted.filter((m) => m.type === "zoom")).toHaveLength(1);
  });
});
