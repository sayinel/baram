// §479 — on Windows/Linux, `menu.rs` binds no native accelerator for Reload
// (Ctrl+R collides with vim mode's redo there), so the registry's global
// keydown dispatch (`useGlobalKeyboard`) is the ONLY delivery path for
// `view.reload`'s default key "Mod+R". This must not double-fire alongside
// vim's redo: every vim redo handler that actually claims Ctrl+R — the
// WYSIWYG state machine (`vim-plugin.ts`'s `handleKeyDown`),
// `vim-code-block-boundary.ts`'s boundary handler, and the third-party
// `@replit/codemirror-vim` (`node_modules/@replit/codemirror-vim/dist/index.js`,
// its main keydown handler) — calls BOTH `preventDefault()` AND
// `stopPropagation()` when it handles the key. Real DOM `stopPropagation()`
// (unlike the app's own `defaultPrevented`-only guard tested in
// `use-global-keyboard-vim-guard.test.ts`) stops the event from ever
// reaching `window`'s bubble-phase listener — no app-level guard is needed
// for this case, but the claim is worth pinning directly rather than only
// by static reading of three separate handlers.
import { fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearActions,
  registerAction,
} from "../../keybindings/keybinding-actions";
import { useGlobalKeyboard } from "../use-global-keyboard";

function renderDispatcher() {
  return renderHook(() =>
    useGlobalKeyboard({
      editor: null,
      findReplaceOpen: false,
      handleGoBack: vi.fn(),
      handleGoForward: vi.fn(),
      isSourceMode: false,
      setTabSwitcherIndex: vi.fn(),
      setTabSwitcherOpen: vi.fn(),
      tabSwitcherMruRef: { current: [] },
      tabSwitcherOpen: false,
    }),
  );
}

/** A stand-in for a vim redo handler: consumes Ctrl+R exactly like the real
 *  ones do (`preventDefault` + `stopPropagation`), attached to a DOM node
 *  the keydown bubbles through before reaching `window`. */
function attachVimLikeConsumer(target: HTMLElement): () => void {
  const handler = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.key === "r") {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  target.addEventListener("keydown", handler);
  return () => target.removeEventListener("keydown", handler);
}

describe("view.reload vs. vim redo — real DOM propagation (§479)", () => {
  const reload = vi.fn();
  let host: HTMLElement;

  beforeEach(() => {
    clearActions();
    reload.mockClear();
    registerAction("view.reload", reload);
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    clearActions();
    host.remove();
  });

  it("fires view.reload for a plain Ctrl+R when nothing upstream consumes it", () => {
    const { unmount } = renderDispatcher();
    fireEvent.keyDown(host, { code: "KeyR", ctrlKey: true, key: "r" });
    expect(reload).toHaveBeenCalledOnce();
    unmount();
  });

  it("does not fire view.reload when an upstream handler consumes Ctrl+R like vim redo does", () => {
    const detach = attachVimLikeConsumer(host);
    const { unmount } = renderDispatcher();
    fireEvent.keyDown(host, { code: "KeyR", ctrlKey: true, key: "r" });
    expect(reload).not.toHaveBeenCalled();
    detach();
    unmount();
  });
});
