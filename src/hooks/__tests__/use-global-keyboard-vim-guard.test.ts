// §298 vim S3 — global keydown dispatcher: defaultPrevented guard + the
// view.sourceMode escape hatch.
//
// Why both exist: vim (inside CodeMirror) preventDefaults every key it
// handles, and those events still bubble to window. Without the guard, on
// Windows/Linux vim's Ctrl+D / Ctrl+O / Ctrl+F would ALSO fire
// bookmark/open/find (research §4.1). But the source editor deliberately
// swallows Mod-/ via preventDefault too — so an unconditional guard would
// trap the user in source mode (Codex plan-review correction). The escape
// hatch runs the source-mode toggle BEFORE the guard.

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearActions,
  registerAction,
} from "../../keybindings/keybinding-actions";
import { useGlobalKeyboard } from "../use-keybinding-actions";

/** jsdom platform is not Mac, so Mod = ctrlKey in normalizeKeyEvent. */
function fireKey(code: string, opts: { prevented?: boolean } = {}) {
  const e = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    code,
    ctrlKey: true,
  });
  if (opts.prevented) e.preventDefault();
  window.dispatchEvent(e);
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

describe("useGlobalKeyboard — vim guard + source-mode escape hatch (§298 S3)", () => {
  const bookmark = vi.fn();
  const sourceToggle = vi.fn();

  beforeEach(() => {
    clearActions();
    bookmark.mockClear();
    sourceToggle.mockClear();
    registerAction("view.bookmark", bookmark); // Mod+D
    registerAction("view.sourceMode", sourceToggle); // Mod+/
  });

  afterEach(() => {
    clearActions();
  });

  it("drops an already-prevented key instead of double-firing the registry command", () => {
    const { unmount } = renderDispatcher(false);
    fireKey("KeyD", { prevented: true }); // e.g. vim's Ctrl+D (half-page down)
    expect(bookmark).not.toHaveBeenCalled();
    unmount();
  });

  it("still fires registry commands for unprevented keys (guard does not overblock)", () => {
    const { unmount } = renderDispatcher(false);
    fireKey("KeyD");
    expect(bookmark).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("ESCAPE HATCH: a prevented Mod-/ still exits source mode", () => {
    // The source editor's swallow keymap preventDefaults Mod-/ — this is the
    // regression Codex flagged: an unconditional guard would trap the user.
    const { unmount } = renderDispatcher(true);
    fireKey("Slash", { prevented: true });
    expect(sourceToggle).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("outside source mode, a prevented Mod-/ is dropped like any other key", () => {
    const { unmount } = renderDispatcher(false);
    fireKey("Slash", { prevented: true });
    expect(sourceToggle).not.toHaveBeenCalled();
    unmount();
  });

  it("unprevented Mod-/ toggles source mode through the normal registry path", () => {
    const { unmount } = renderDispatcher(false);
    fireKey("Slash");
    expect(sourceToggle).toHaveBeenCalledTimes(1);
    unmount();
  });
});
