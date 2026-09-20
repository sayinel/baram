// §361 Task 6 fix round 1 — source mode follows the document's light/dark answer too.
//
// The same 0088 M3 defect the WYSIWYG code block had, in the app's other CodeMirror:
// `getHighlightStyle()` is read once while building a view whose effect has `[]` deps and
// which is deliberately never rebuilt (that effect's own closing comment forbids it,
// because a rebuild discards the undo stack, the caret and the scroll position). So an OS
// light/dark switch left the highlighting behind, and the app's two code editors disagreed
// about whether highlighting follows the OS.
//
// Fixed with the same compartment reuse, which is why this file is short: what it has to
// pin is that `SourceCodeEditor` is wired to `subscribeHighlightStyle` at all, and that the
// view survives the change. The watcher's own behaviour is pinned next door in
// `extensions/nodes/__tests__/code-block-highlight-scheme.test.ts`.
import { highlightingFor } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Records the release without stubbing it — the wrapper calls the real
 * `subscribeHighlightStyle` and the real unsubscribe, so every behavioural assertion in
 * this file still runs against the actual watcher.
 *
 * ‼️ It exists because the unmount case had no assertion at all in its first form. That
 * version said a dispatch into a destroyed view would throw loudly; measured (fix round 1),
 * deleting the `unsubscribeHighlight()` call from the cleanup left the whole file green.
 * A release is only observable by watching for it.
 */
const releaseCalls = vi.hoisted(() => vi.fn());
vi.mock("../../../extensions/nodes/code-block-highlight", async (orig) => {
  const actual =
    await orig<
      typeof import("../../../extensions/nodes/code-block-highlight")
    >();
  return {
    ...actual,
    subscribeHighlightStyle: (
      listener: Parameters<typeof actual.subscribeHighlightStyle>[0],
    ) => {
      const release = actual.subscribeHighlightStyle(listener);
      return () => {
        releaseCalls();
        release();
      };
    },
  };
});

import {
  darkHighlightStyle,
  lightHighlightStyle,
} from "../../../extensions/nodes/code-block-highlight";
import { SourceCodeEditor } from "../SourceCodeEditor";

const LIGHT_KEYWORD = lightHighlightStyle.style([tags.keyword]);
const DARK_KEYWORD = darkHighlightStyle.style([tags.keyword]);

/** A controllable `(prefers-color-scheme: dark)`; the shared polyfill answers a fixed
 *  `false` with no-op listeners, so neither branch could be exercised through it. */
function installMatchMedia(matches: boolean): {
  fire: (next: boolean) => void;
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
      for (const fn of [...listeners]) {
        fn({ matches: next } as MediaQueryListEvent);
      }
    },
    restore() {
      window.matchMedia = original;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let media: ReturnType<typeof installMatchMedia>;

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
  media = installMatchMedia(false);
  releaseCalls.mockClear();
});

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  media.restore();
});

function renderSource() {
  const view = render(
    <SourceCodeEditor
      content={"const x = 1;\n"}
      getLatestContent={() => "const x = 1;\n"}
      onChange={vi.fn()}
    />,
  );
  const dom = view.container.querySelector(".cm-editor") as HTMLElement;
  return { cm: EditorView.findFromDOM(dom)!, dom, view };
}

describe("source mode follows the OS light/dark switch", () => {
  it("mints a different keyword class for each style", () => {
    // Without this the comparisons below would pass for a pair that had collapsed to one
    // class, which is the shape a change to either definition could produce.
    expect(LIGHT_KEYWORD).not.toBe(DARK_KEYWORD);
  });

  it("moves to the dark style, without replacing the view", async () => {
    const { cm, dom, view } = renderSource();
    expect(highlightingFor(cm.state, [tags.keyword])).toBe(LIGHT_KEYWORD);

    await act(async () => {
      media.fire(true);
      await settle();
    });

    expect(highlightingFor(cm.state, [tags.keyword])).toBe(DARK_KEYWORD);
    // The reason a compartment was used rather than a rebuild: this view is the same one,
    // still attached. A rebuild would take the undo stack, the caret and the scroll
    // position with it — `source-editor-external-content.test.tsx` is the suite that
    // exists because those losses are data loss here.
    expect(dom.isConnected).toBe(true);
    expect(view.container.querySelector(".cm-editor")).toBe(dom);

    view.unmount();
  });

  it("releases its subscription when the surface unmounts", async () => {
    const { view } = renderSource();
    // The positive half: mounting subscribed and nothing has been released yet, so the
    // assertion after unmount is about the unmount and not about a counter that was
    // already non-zero.
    expect(releaseCalls).not.toHaveBeenCalled();

    view.unmount();

    expect(releaseCalls).toHaveBeenCalledTimes(1);
    // And nothing reaches the destroyed view afterwards.
    await act(async () => {
      media.fire(true);
      await settle();
    });
  });
});
