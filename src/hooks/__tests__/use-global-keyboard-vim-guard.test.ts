// §298 vim S3 — global keydown dispatcher: the SCOPED defaultPrevented guard
// and the view.sourceMode escape hatch.
//
// The guard is scoped to a live vim source session (event target inside
// .source-code-editor AND vimStatusMode non-null). A blanket guard regressed
// WYSIWYG: extensions there also preventDefault (Mod+Shift+B blockquote) and
// their long-standing double-fire with registry commands (backlinks) is not
// this feature's to change (Codex final gate). Events are dispatched from
// REAL DOM targets so bubbling and e.target scoping are actually exercised —
// firing pre-cancelled events at window directly hid exactly that (Codex).

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearActions,
  registerAction,
} from "../../keybindings/keybinding-actions";
import { useUIStore } from "../../stores/ui/ui";
import { useGlobalKeyboard } from "../use-keybinding-actions";

/** jsdom platform is not Mac, so Mod = ctrlKey in normalizeKeyEvent. */
function fireKeyFrom(
  target: Element,
  code: string,
  opts: { prevented?: boolean; shift?: boolean } = {},
): KeyboardEvent {
  const e = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    code,
    ctrlKey: true,
    shiftKey: opts.shift ?? false,
  });
  if (opts.prevented) e.preventDefault();
  target.dispatchEvent(e);
  return e;
}

function renderDispatcher(isSourceMode: boolean) {
  return renderHook(() =>
    useGlobalKeyboard({
      editor: null,
      findReplaceOpen: false,
      handleGoBack: vi.fn(),
      handleGoForward: vi.fn(),
      isSourceMode,
      setTabSwitcherIndex: vi.fn(),
      setTabSwitcherOpen: vi.fn(),
      tabSwitcherMruRef: { current: [] },
      tabSwitcherOpen: false,
    }),
  );
}

describe("useGlobalKeyboard — scoped vim guard + escape hatch (§298 S3)", () => {
  const bookmark = vi.fn();
  const backlinks = vi.fn();
  const sourceToggle = vi.fn();

  let sourceEditorEl: HTMLElement;
  let insideSource: HTMLElement;
  let outside: HTMLElement;

  beforeEach(() => {
    clearActions();
    bookmark.mockClear();
    backlinks.mockClear();
    sourceToggle.mockClear();
    registerAction("view.bookmark", bookmark); // Mod+D
    registerAction("search.backlinks", backlinks); // Mod+Shift+B
    registerAction("view.sourceMode", sourceToggle); // Mod+/
    useUIStore.getState().setVimStatusMode(null);

    sourceEditorEl = document.createElement("div");
    sourceEditorEl.className = "source-code-editor";
    insideSource = document.createElement("div");
    sourceEditorEl.appendChild(insideSource);
    outside = document.createElement("div");
    document.body.appendChild(sourceEditorEl);
    document.body.appendChild(outside);
  });

  afterEach(() => {
    clearActions();
    useUIStore.getState().setVimStatusMode(null);
    sourceEditorEl.remove();
    outside.remove();
  });

  it("WYSIWYG regression: a prevented Mod+Shift+B outside the source editor still fires backlinks", () => {
    // ProseMirror's blockquote handles Mod+Shift+B with preventDefault; the
    // pre-existing double-fire with search.backlinks must stay untouched.
    const { unmount } = renderDispatcher(false);
    fireKeyFrom(outside, "KeyB", { prevented: true, shift: true });
    expect(backlinks).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("drops a prevented key from a LIVE vim source session (no double-fire)", () => {
    useUIStore.getState().setVimStatusMode("normal");
    const { unmount } = renderDispatcher(true);
    fireKeyFrom(insideSource, "KeyD", { prevented: true });
    expect(bookmark).not.toHaveBeenCalled();
    unmount();
  });

  it("does NOT drop when vim is off, even inside the source editor", () => {
    const { unmount } = renderDispatcher(true);
    fireKeyFrom(insideSource, "KeyD", { prevented: true });
    expect(bookmark).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("does NOT drop prevented events from outside the source editor during a vim session", () => {
    useUIStore.getState().setVimStatusMode("normal");
    const { unmount } = renderDispatcher(true);
    fireKeyFrom(outside, "KeyD", { prevented: true });
    expect(bookmark).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("ESCAPE HATCH: a prevented Mod-/ from a live vim source session still exits source mode", () => {
    // The source editor's swallow keymap preventDefaults Mod-/ (vim binds no
    // <M-/>), so without the hatch the scoped guard would trap the user.
    useUIStore.getState().setVimStatusMode("normal");
    const { unmount } = renderDispatcher(true);
    fireKeyFrom(insideSource, "Slash", { prevented: true });
    expect(sourceToggle).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("still fires registry commands for unprevented keys inside a vim session", () => {
    useUIStore.getState().setVimStatusMode("normal");
    const { unmount } = renderDispatcher(true);
    fireKeyFrom(insideSource, "KeyD");
    expect(bookmark).toHaveBeenCalledTimes(1);
    unmount();
  });
});
