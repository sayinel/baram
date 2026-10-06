// §391 spec 0070 §8 (키 처리) · D8 · D10 · D17 — a plugin shortcut in the global keydown handler.
// Events are dispatched from real elements so bubbling to window is exercised, as in
// use-global-keyboard-vim-guard.test.ts. jsdom is not a Mac: Mod is ctrlKey.
import type { PluginManifest } from "../../plugins/types";

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({
  execute: vi.fn(async (..._a: unknown[]) => {}),
}));
vi.mock("../../plugins/plugin-host-registry", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../plugins/plugin-host-registry")
  >()),
  executePluginCommand: (...a: unknown[]) => execute(...a),
}));

import {
  clearActions,
  registerAction,
} from "../../keybindings/keybinding-actions";
import { registerEntryContributions } from "../../plugins/plugin-entry-points";
import {
  commandHandlers,
  commandOwners,
  registerHostCommandHandler,
} from "../../plugins/plugin-host-registry";
import { usePluginUIStore } from "../../plugins/plugin-ui-store";
import {
  markPromptClosed,
  markPromptOpen,
  resetPromptGate,
} from "../../plugins/prompt-gate";
import { unregisterPluginUI } from "../../plugins/trusted/ui-api";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { useGlobalKeyboard } from "../use-global-keyboard";

/** A trusted plugin that DECLARES `insert` — whether it registered a handler is per test. */
const CITE: PluginManifest = {
  author: "t",
  capabilities: ["commands"],
  contributions: { commands: [{ id: "insert", title: "Insert citation" }] },
  description: "d",
  engines: { baram: ">=0.5.0" },
  id: "cite",
  license: "MIT",
  main: "index.mjs",
  name: "Cite",
  trust: "trusted",
  version: "1.0.0",
};

function press(
  opts: { alt?: boolean; code?: string; repeat?: boolean } = {},
): KeyboardEvent {
  const e = new KeyboardEvent("keydown", {
    altKey: opts.alt ?? true,
    bubbles: true,
    cancelable: true,
    code: opts.code ?? "KeyK",
    ctrlKey: true,
    repeat: opts.repeat ?? false,
  });
  document.body.dispatchEvent(e);
  return e;
}

function renderDispatcher(isSourceMode = false) {
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

const handler = () =>
  registerHostCommandHandler("cite.insert", () => {}, "cite");

beforeEach(() => {
  usePluginUIStore.setState({ contributions: {} });
  useSettingsStore.setState({
    keybindingOverrides: { "plugin:cite.insert": "Mod+Alt+K" },
  });
  useUIStore.getState().setVimStatus(null);
  registerEntryContributions(CITE);
});
afterEach(() => {
  commandHandlers.clear();
  commandOwners.clear();
  resetPromptGate();
  clearActions();
  useUIStore.getState().setVimStatus(null);
  execute.mockReset();
});

describe("a plugin shortcut (§391 §8)", () => {
  it("runs executePluginCommand with the full command id, and claims the key", () => {
    handler();
    const { unmount } = renderDispatcher();
    const e = press();
    expect(execute).toHaveBeenCalledWith("cite.insert");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    unmount();
  });

  it("D8 — a repeated keydown runs nothing, but the key is still claimed", () => {
    handler();
    const { unmount } = renderDispatcher();
    const e = press({ repeat: true });
    expect(execute).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
    unmount();
  });

  it("with no handler — declared, never registered by the trusted plugin — the key is left alone, repeat or not", () => {
    const { unmount } = renderDispatcher();
    for (const repeat of [false, true]) {
      expect(press({ repeat }).defaultPrevented).toBe(false);
    }
    expect(execute).not.toHaveBeenCalled();
    unmount();
  });

  it("D17 — with a §385 prompt open, nothing runs and the key stays the prompt's", () => {
    handler();
    const prompt = {
      close: vi.fn(),
      pluginId: "cite",
      root: document.createElement("div"),
    };
    markPromptOpen(prompt);
    const { unmount } = renderDispatcher();
    const e = press();
    expect(execute).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
    // The positive half: the same key runs once the prompt has closed.
    markPromptClosed(prompt);
    press();
    expect(execute).toHaveBeenCalledWith("cite.insert");
    unmount();
  });

  it("a core command on the same key wins; the plugin command does not run", () => {
    handler();
    useSettingsStore.setState({
      keybindingOverrides: { "plugin:cite.insert": "Mod+D" },
    });
    const bookmark = vi.fn();
    registerAction("view.bookmark", bookmark); // Mod+D
    const { unmount } = renderDispatcher();
    press({ alt: false, code: "KeyD" });
    expect(bookmark).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
    unmount();
  });

  it("D10 — the key outlives an unload, does nothing meanwhile, and works again when the plugin is back", () => {
    handler();
    const { unmount } = renderDispatcher();
    unregisterPluginUI("cite");
    expect(press().defaultPrevented).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().keybindingOverrides).toEqual({
      "plugin:cite.insert": "Mod+Alt+K",
    });
    registerEntryContributions(CITE);
    press();
    expect(execute).toHaveBeenCalledWith("cite.insert");
    unmount();
  });

  it("the vim source-session guard runs first, as for every registry command", () => {
    handler();
    useUIStore.getState().setVimStatus({ mode: "normal", surface: "source" });
    const editorEl = document.createElement("div");
    editorEl.className = "source-code-editor";
    const inside = document.createElement("div");
    editorEl.appendChild(inside);
    document.body.appendChild(editorEl);
    const { unmount } = renderDispatcher(true);
    const e = new KeyboardEvent("keydown", {
      altKey: true,
      bubbles: true,
      cancelable: true,
      code: "KeyK",
      ctrlKey: true,
    });
    e.preventDefault(); // CodeMirror's keymap handled it
    inside.dispatchEvent(e);
    expect(execute).not.toHaveBeenCalled();
    unmount();
    editorEl.remove();
  });
});
