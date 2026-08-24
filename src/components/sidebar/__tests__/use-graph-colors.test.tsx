import { useEffect } from "react";

import { act, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// §30 Graph View — theme reactivity of the resolved graph colours
import { useGraphColors } from "../use-graph-colors";

/**
 * jsdom implements neither `matchMedia` nor a `prefers-color-scheme` cascade.
 *
 * The fake keeps its listeners so the media path can be exercised for real rather than
 * merely stubbed away: a hook that forgot to subscribe would still pass against a stub
 * whose events never arrive.
 */
let mediaListeners: Set<() => void>;

function installMatchMedia(): void {
  mediaListeners = new Set();
  window.matchMedia = ((query: string) => ({
    addEventListener: (_type: string, fn: () => void) => {
      mediaListeners.add(fn);
    },
    matches: false,
    media: query,
    removeEventListener: (_type: string, fn: () => void) => {
      mediaListeners.delete(fn);
    },
  })) as unknown as typeof window.matchMedia;
}

/** `--color-graph-label` in a stylesheet, so it can be changed without touching the root. */
function installTokens(): CSSStyleSheet {
  const style = document.createElement("style");
  style.dataset.test = "tokens";
  style.textContent =
    ':root { --color-graph-label: #111111; } :root[data-theme="dark"] { --color-graph-label: #222222; }';
  document.head.append(style);
  return style.sheet as CSSStyleSheet;
}

beforeEach(() => {
  installMatchMedia();
});

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("style");
  document.head.querySelectorAll("style[data-test]").forEach((el) => {
    el.remove();
  });
  Reflect.deleteProperty(window, "matchMedia");
});

describe("useGraphColors", () => {
  it("resolves the tokens on mount", () => {
    installTokens();
    const { result } = renderHook(() => useGraphColors());
    expect(result.current.label).toBe("#111111");
  });

  it("re-resolves when the theme base changes", async () => {
    installTokens();
    const { result } = renderHook(() => useGraphColors());

    await act(async () => {
      document.documentElement.dataset.theme = "dark";
    });

    expect(result.current.label).toBe("#222222");
  });

  it("re-resolves when a theme writes inline overrides to the root", async () => {
    installTokens();
    const { result } = renderHook(() => useGraphColors());

    // §54 applies a custom theme — and the theme editor previews one — by setting the
    // variables directly on the root element.
    await act(async () => {
      document.documentElement.style.setProperty(
        "--color-graph-label",
        "#333333",
      );
    });

    expect(result.current.label).toBe("#333333");
  });

  it("re-resolves when the system colour scheme changes", async () => {
    const sheet = installTokens();
    const { result } = renderHook(() => useGraphColors());

    // Changed through the stylesheet on purpose: it mutates no attribute on the root, so
    // the MutationObserver cannot fire and only the media listener can carry this.
    sheet.insertRule(
      ":root { --color-graph-label: #444444; }",
      sheet.cssRules.length,
    );
    await act(async () => {});
    expect(result.current.label).toBe("#111111");

    act(() => {
      for (const listener of mediaListeners) listener();
    });

    expect(result.current.label).toBe("#444444");
  });

  it("keeps the same object when nothing it reads changed", async () => {
    installTokens();
    const { result } = renderHook(() => useGraphColors());
    const first = result.current;

    // An unrelated root mutation still notifies the observer; re-styling the graph for it
    // would be pure waste, so the previous object has to survive identity comparison.
    await act(async () => {
      document.documentElement.style.setProperty(
        "--color-text-primary",
        "#f0f",
      );
    });

    expect(result.current).toBe(first);
  });

  it("catches a theme applied between render and its own effect", () => {
    installTokens();
    const seen: string[] = [];

    // The gap this covers: §54 writes the theme from its own effect, and within one commit
    // that effect can run BEFORE this hook's. The mutation then predates observe(), so no
    // MutationObserver record exists for it and only the resolve that follows observe()
    // recovers the value. Harness stands in for §54: its effect is declared first, so React
    // runs it first.
    function Harness() {
      useEffect(() => {
        document.documentElement.style.setProperty(
          "--color-graph-label",
          "#555555",
        );
      }, []);
      seen.push(useGraphColors().label);
      return null;
    }

    render(<Harness />);

    expect(seen.at(-1)).toBe("#555555");
  });

  it("stops observing on unmount", () => {
    installTokens();
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    const { unmount } = renderHook(() => useGraphColors());
    expect(mediaListeners.size).toBe(1);

    unmount();

    expect(mediaListeners.size).toBe(0);
    expect(disconnect).toHaveBeenCalled();
    disconnect.mockRestore();
  });
});
