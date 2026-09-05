// issue 539 — no native page menu ("Reload") anywhere the app does not draw
// its own.
//
// WKWebView shows its page menu for every right-click nobody prevents; in
// this app that menu is a single "Reload", which restarts the webview and
// drops the session. The policy runs last, on document, in the bubble phase:
// an owner that already prevented is left alone, a text control or
// contenteditable keeps the browser's edit menu, a <select> gets nothing
// (the editor's rule), a dev build keeps "Inspect Element", and everything
// else is prevented. fireEvent.contextMenu returns !defaultPrevented.
import { fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useNativeContextMenuPolicy } from "../use-native-context-menu-policy";

const mounted: HTMLElement[] = [];

function attach<T extends HTMLElement>(el: T): T {
  document.body.appendChild(el);
  mounted.push(el);
  return el;
}

afterEach(() => {
  for (const el of mounted.splice(0)) el.remove();
  vi.unstubAllEnvs();
});

describe("in a release build", () => {
  it("prevents the page menu on bare chrome", () => {
    vi.stubEnv("DEV", false);
    renderHook(() => useNativeContextMenuPolicy());
    const panel = attach(document.createElement("div"));

    expect(fireEvent.contextMenu(panel)).toBe(false);
    expect(fireEvent.contextMenu(document.body)).toBe(false);
  });

  it("leaves text controls and contenteditable to the browser", () => {
    vi.stubEnv("DEV", false);
    renderHook(() => useNativeContextMenuPolicy());
    const textarea = attach(document.createElement("textarea"));
    const input = attach(document.createElement("input"));
    const editable = attach(document.createElement("div"));
    editable.setAttribute("contenteditable", "true");
    const inner = document.createElement("span");
    editable.appendChild(inner);

    expect(fireEvent.contextMenu(textarea)).toBe(true);
    expect(fireEvent.contextMenu(input)).toBe(true);
    expect(fireEvent.contextMenu(inner)).toBe(true);
  });

  it("gives a <select> no menu at all, like the editor does", () => {
    vi.stubEnv("DEV", false);
    renderHook(() => useNativeContextMenuPolicy());
    const select = attach(document.createElement("select"));

    expect(fireEvent.contextMenu(select)).toBe(false);
  });

  it("does not touch an event an owner already prevented", () => {
    vi.stubEnv("DEV", false);
    renderHook(() => useNativeContextMenuPolicy());
    const owner = attach(document.createElement("div"));
    const seen: boolean[] = [];
    owner.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      seen.push(e.defaultPrevented);
    });
    const spy = vi.fn();
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    const original = event.preventDefault.bind(event);
    event.preventDefault = () => {
      spy();
      original();
    };

    owner.dispatchEvent(event);

    expect(seen).toEqual([true]);
    // The owner's call, and only the owner's.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("stops listening when unmounted", () => {
    vi.stubEnv("DEV", false);
    const { unmount } = renderHook(() => useNativeContextMenuPolicy());
    const panel = attach(document.createElement("div"));
    expect(fireEvent.contextMenu(panel)).toBe(false);

    unmount();

    expect(fireEvent.contextMenu(panel)).toBe(true);
  });
});

describe("in a dev build", () => {
  it("keeps the page menu so Inspect Element stays reachable", () => {
    vi.stubEnv("DEV", true);
    renderHook(() => useNativeContextMenuPolicy());
    const panel = attach(document.createElement("div"));

    expect(fireEvent.contextMenu(panel)).toBe(true);
  });
});

describe("classification details", () => {
  it("sees through Shadow DOM: an input inside a plugin panel keeps the native menu, its chrome does not", () => {
    vi.stubEnv("DEV", false);
    renderHook(() => useNativeContextMenuPolicy());
    const host = attach(document.createElement("div"));
    const shadow = host.attachShadow({ mode: "open" });
    const input = document.createElement("input");
    const chrome = document.createElement("div");
    shadow.append(input, chrome);

    expect(fireEvent.contextMenu(input)).toBe(true);
    expect(fireEvent.contextMenu(chrome)).toBe(false);
  });

  it("treats a range slider and a colour picker as chrome, not text", () => {
    vi.stubEnv("DEV", false);
    renderHook(() => useNativeContextMenuPolicy());
    const range = attach(document.createElement("input"));
    range.type = "range";
    const color = attach(document.createElement("input"));
    color.type = "color";

    expect(fireEvent.contextMenu(range)).toBe(false);
    expect(fireEvent.contextMenu(color)).toBe(false);
  });

  it("respects a contenteditable=false island inside an editable host", () => {
    vi.stubEnv("DEV", false);
    renderHook(() => useNativeContextMenuPolicy());
    const host = attach(document.createElement("div"));
    host.setAttribute("contenteditable", "true");
    const island = document.createElement("div");
    island.setAttribute("contenteditable", "false");
    host.appendChild(island);

    expect(fireEvent.contextMenu(host)).toBe(true);
    expect(fireEvent.contextMenu(island)).toBe(false);
  });
});
