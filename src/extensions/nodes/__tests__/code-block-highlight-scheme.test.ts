// §361 / 0088 final review M3 — the highlight style a MOUNTED code block wears follows the
// document's light/dark answer.
//
// The defect this pins, measured on this branch before the fix: with `data-theme` absent
// (the `system` theme, which is the shipped default — `appearance-settings.ts` starts at
// `activeThemeId: "system"`) and `prefers-color-scheme` flipped from light to dark, a
// mounted block still resolved `tags.keyword` to the LIGHT class. The settings store's
// `theme` field, which the NodeView used to watch, stays `"system"` across that switch.
//
// The two inputs `getHighlightStyle` reads are watched by two DIFFERENT mechanisms — a
// `MutationObserver` for `data-theme` and a `change` listener for the media query — so each
// gets its own case here. One case passing tells you nothing about the other.
import { highlightingFor } from "@codemirror/language";
import { EditorView as CMView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "../..";
import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import { useSettingsStore } from "../../../stores/settings/store";
import {
  darkHighlightStyle,
  getHighlightStyle,
  lightHighlightStyle,
  subscribeHighlightStyle,
} from "../code-block-highlight";

declare const MockIntersectionObserver: {
  instances: { triggerIntersect: (v?: boolean) => void }[];
};

/**
 * Fire intersection on every tracked observer rather than only the newest.
 *
 * `instances` accumulates for the whole file and a destroyed editor's entry stays in it, so
 * `at(-1)` names the code block's observer only in a file that mounts exactly once —
 * `code-block-lazy.test.ts` does, this one does not, and picking the wrong instance leaves
 * CodeMirror unbuilt. A disconnected observer has had its element set cleared, so firing it
 * delivers nothing.
 */
function triggerAllIntersections(): void {
  for (const instance of MockIntersectionObserver.instances) {
    instance.triggerIntersect(true);
  }
}

/**
 * The class CodeMirror puts on a keyword span under each style.
 *
 * Read off the styles themselves rather than typed in: `HighlightStyle.define` mints these
 * (`ͼo` / `ͼ19` at the time of writing) and they move as soon as anything is added to
 * either definition. Asserted distinct below, because every assertion in this file compares
 * the two — if they ever collapsed to one string the comparisons would pass vacuously.
 */
const LIGHT_KEYWORD = lightHighlightStyle.style([tags.keyword]);
const DARK_KEYWORD = darkHighlightStyle.style([tags.keyword]);

/** A controllable `(prefers-color-scheme: dark)`. The shared polyfill in
 *  `src/test-setup.ts` is `matches: false` with no-op listeners, so neither branch of
 *  `getHighlightStyle` can be exercised through it; overridden here and restored after. */
function installMatchMedia(matches: boolean): {
  fire: (next: boolean) => void;
  listenerCount: () => number;
  restore: () => void;
} {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    addEventListener: (_t: string, fn: (e: MediaQueryListEvent) => void) => {
      listeners.add(fn);
    },
    matches,
    removeEventListener: (_t: string, fn: (e: MediaQueryListEvent) => void) => {
      listeners.delete(fn);
    },
  };
  const original = window.matchMedia;
  window.matchMedia = (() => mql) as unknown as typeof window.matchMedia;
  return {
    fire(next: boolean) {
      mql.matches = next;
      for (const fn of [...listeners])
        fn({ matches: next } as MediaQueryListEvent);
    },
    /** How many listeners the watcher currently holds on this query — the observable half
     *  of its teardown (0090 final review, F3). */
    listenerCount: () => listeners.size,
    restore() {
      window.matchMedia = original;
    },
  };
}

/** An editor holding one mounted (CodeMirror-attached) code block. */
async function mountedCodeBlock(): Promise<{
  cm: CMView;
  destroy: () => void;
  dom: HTMLElement;
}> {
  // Mounted into the real document, not left in Tiptap's detached default element: the
  // recreate check below reads `isConnected`, which is false for every node in a detached
  // tree and would make that assertion fail for a reason that has nothing to do with the
  // theme.
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    content: "",
    element: host,
    extensions: createBaramExtensions(),
  });
  editor.commands.setContent(
    markdownToProsemirror("```ts\nconst x = 1;\n```\n", editor.schema).toJSON(),
  );
  const dom = editor.view.dom as HTMLElement;
  triggerAllIntersections();
  await vi.waitFor(() => {
    expect(dom.querySelector(".cm-editor")).not.toBeNull();
  });
  const cmDom = dom.querySelector(".cm-editor") as HTMLElement;
  return {
    cm: CMView.findFromDOM(cmDom)!,
    destroy: () => {
      editor.destroy();
      host.remove();
    },
    dom,
  };
}

/** `MutationObserver` records are delivered at a microtask checkpoint, so nothing here is
 *  observable in the same tick as the write that caused it. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("a mounted code block follows the document's light/dark answer (M3)", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("mints a different keyword class for each style", () => {
    // What makes the three cases below meaningful. Without it a change that collapsed the
    // two styles onto one class would make every "moved to dark" assertion pass by default.
    expect(LIGHT_KEYWORD).not.toBe(DARK_KEYWORD);
    expect(LIGHT_KEYWORD).not.toBeNull();
    expect(DARK_KEYWORD).not.toBeNull();
  });

  it("follows an OS switch while no data-theme is set", async () => {
    const media = installMatchMedia(false);
    const block = await mountedCodeBlock();
    try {
      expect(highlightingFor(block.cm.state, [tags.keyword])).toBe(
        LIGHT_KEYWORD,
      );

      media.fire(true);
      await settle();

      expect(highlightingFor(block.cm.state, [tags.keyword])).toBe(
        DARK_KEYWORD,
      );
    } finally {
      block.destroy();
      media.restore();
    }
  });

  it("follows a data-theme change, and does so without recreating CodeMirror", async () => {
    const media = installMatchMedia(false);
    const block = await mountedCodeBlock();
    try {
      expect(highlightingFor(block.cm.state, [tags.keyword])).toBe(
        LIGHT_KEYWORD,
      );
      const before = block.dom.querySelector(".cm-editor");

      document.documentElement.dataset.theme = "dark";
      await settle();

      expect(highlightingFor(block.cm.state, [tags.keyword])).toBe(
        DARK_KEYWORD,
      );
      // The reason this is a reconfigure and not a recreate: the pre-change element is the
      // one still in the document. A teardown/rebuild would leave `before` detached and put
      // a different element in its place, which `toBe` catches even though both would be
      // `.cm-editor`s carrying the dark class.
      expect(before?.isConnected).toBe(true);
      expect(block.dom.querySelector(".cm-editor")).toBe(before);
    } finally {
      block.destroy();
      media.restore();
    }
  });

  it("no longer tears CodeMirror down when the settings store's theme field moves", async () => {
    const media = installMatchMedia(false);
    const previousThemeId = useSettingsStore.getState().activeThemeId;
    const block = await mountedCodeBlock();
    try {
      const before = block.dom.querySelector(".cm-editor");

      // What the NodeView used to watch. It still moves — this is the ordinary
      // "user picks Default Dark" write — and the old subscription answered it with
      // `teardownCM()` + `initCM()`. Nothing in `buildCodeBlockExtensions` needs that:
      // the one theme-dependent call in it is behind the compartment now.
      useSettingsStore.getState().setActiveTheme("default-dark");
      expect(useSettingsStore.getState().theme).toBe("dark");
      await settle();

      expect(before?.isConnected).toBe(true);
      expect(block.dom.querySelector(".cm-editor")).toBe(before);
    } finally {
      useSettingsStore.getState().setActiveTheme(previousThemeId);
      block.destroy();
      media.restore();
    }
  });

  it("leaves the style alone when the inputs move but the answer does not", async () => {
    const media = installMatchMedia(false);
    const block = await mountedCodeBlock();
    try {
      // `data-theme` goes from absent to "light" — a real attribute mutation, and the same
      // one `use-settings-effects.ts` writes when a user picks Default Light while the OS is
      // already light. The answer does not move, so nothing should be dispatched.
      document.documentElement.dataset.theme = "light";
      await settle();

      expect(highlightingFor(block.cm.state, [tags.keyword])).toBe(
        LIGHT_KEYWORD,
      );
    } finally {
      block.destroy();
      media.restore();
    }
  });
});

describe("subscribeHighlightStyle", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("notifies on a change and stays silent on a no-op", async () => {
    const media = installMatchMedia(false);
    const seen: unknown[] = [];
    const unsubscribe = subscribeHighlightStyle((style) => seen.push(style));
    try {
      // Subscribing is not itself an event — the caller already has `getHighlightStyle()`.
      expect(seen).toEqual([]);

      document.documentElement.dataset.theme = "light";
      await settle();
      expect(seen).toEqual([]);

      document.documentElement.dataset.theme = "dark";
      await settle();
      expect(seen).toEqual([darkHighlightStyle]);

      // Same value written again: an attribute mutation record is still produced, and the
      // equality gate is the only thing that stops a second notification.
      document.documentElement.dataset.theme = "dark";
      await settle();
      expect(seen).toEqual([darkHighlightStyle]);
    } finally {
      unsubscribe();
      media.restore();
    }
  });

  it("keeps watching while another listener remains (refcount, not a toggle)", async () => {
    // Fix round 1 (F3). The watcher is attached on the FIRST subscribe and torn down on the
    // LAST unsubscribe; nothing pinned the "last" half, so an implementation that detached
    // on any unsubscribe passed every other case in this file — each of which subscribes
    // exactly once.
    const media = installMatchMedia(false);
    const first: unknown[] = [];
    const second: unknown[] = [];
    const unsubscribeFirst = subscribeHighlightStyle((s) => first.push(s));
    const unsubscribeSecond = subscribeHighlightStyle((s) => second.push(s));
    try {
      unsubscribeFirst();

      document.documentElement.dataset.theme = "dark";
      await settle();

      expect(second).toEqual([darkHighlightStyle]);
      // …and the one that left really did stop, so this is a refcount rather than "the
      // teardown never runs".
      expect(first).toEqual([]);
    } finally {
      unsubscribeSecond();
      media.restore();
    }
  });

  it("releases both watchers when the last listener leaves — RED if the teardown body is emptied", () => {
    // 0090 final review (F3). The refcount GUARD was pinned (the case above), the teardown
    // BODY was not: replacing it with `() => {}` left both highlight suites green, 11/11.
    // Delivery alone cannot catch that — the listeners that leak are idle, and the equality
    // gate makes a duplicate broadcast a no-op — so this watches the two release calls.
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    const media = installMatchMedia(false);
    try {
      const before = disconnect.mock.calls.length;
      const unsubscribe = subscribeHighlightStyle(() => {});
      // The positive half: subscribing really did attach, so the 0 below is a release
      // rather than an attach that never happened.
      expect(media.listenerCount()).toBe(1);

      unsubscribe();

      expect(media.listenerCount()).toBe(0);
      expect(disconnect.mock.calls.length).toBe(before + 1);
    } finally {
      disconnect.mockRestore();
      media.restore();
    }
  });

  it("stops delivering after the last listener leaves", async () => {
    const media = installMatchMedia(false);
    const seen: unknown[] = [];
    const unsubscribe = subscribeHighlightStyle((style) => seen.push(style));
    unsubscribe();
    try {
      media.fire(true);
      document.documentElement.dataset.theme = "dark";
      await settle();

      expect(seen).toEqual([]);
      // …and the watcher really did restart for the next subscriber rather than staying
      // torn down: `getHighlightStyle` now answers dark, and a fresh subscription must be
      // able to see the move BACK.
      expect(getHighlightStyle()).toBe(darkHighlightStyle);
      const second: unknown[] = [];
      const unsubscribe2 = subscribeHighlightStyle((s) => second.push(s));
      document.documentElement.dataset.theme = "light";
      await settle();
      expect(second).toEqual([lightHighlightStyle]);
      unsubscribe2();
    } finally {
      media.restore();
    }
  });
});
