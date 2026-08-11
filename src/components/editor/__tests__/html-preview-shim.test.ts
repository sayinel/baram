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
  key: (init: KeyboardEventInit) => { prevented: boolean };
  open: (url?: string) => unknown;
  parent: object;
  posted: Record<string, unknown>[];
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

  const fakeWindow = {
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      const existing = windowListeners.get(type) ?? [];
      existing.push(handler);
      windowListeners.set(type, existing);
    },
    open: vi.fn(() => "native-window"),
    parent,
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
    open: fakeWindow.open as (url?: string) => unknown,
    parent,
    posted,
  };
}

/** The harness has to be able to tell the two link outcomes apart at all. */
it("harness sanity: the document really is served over the preview scheme", () => {
  expect(mount().doc.baseURI).toBe(DOC_URL);
});

describe("bridge scope", () => {
  /** The frame paints nothing, so it needs nothing from the host — and a bridge
   *  that receives nothing has no handshake to miss and no state to fall out of
   *  sync. Zoom in particular must not depend on this script existing. */
  it("says nothing until the page does something, and listens for nothing", () => {
    const { posted } = mount("<p>hello</p>");
    expect(posted).toEqual([]);
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
