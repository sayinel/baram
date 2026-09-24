// §37 — Alt+←/→ navigates back/forward on Windows/Linux only. On macOS
// Option+←/→ is the text system's move-by-word binding (moveWordLeft: /
// moveWordRight:), which WebKit's text fields and contenteditable follow, and
// the design gives macOS ⌃- / ⌃⇧- for back/forward instead (part4 shortcut
// table, part9 appendix). Events are dispatched from REAL targets — the WYSIWYG
// editor's contenteditable with the app's extension set, and a plain <input> —
// so what is tested is whether the key reaches the window listener and what
// that listener does with it. The Windows/Linux cases are the positive pair:
// they show the same targets and harness do deliver the key to the listener.

import type { Mock } from "vitest";

import { renderHook } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "../../extensions";
import { useEditorStore } from "../../stores/editor/editor";
import { useSettingsStore } from "../../stores/settings/store";
import { useGlobalKeyboard } from "../use-global-keyboard";

// The removed §56b branch opened the day's file through this before anything
// else (the call precedes its first await), so a branch that reclaims Alt+←
// for the journal shows up here even when it also falls through to §37.
const { ensureJournalFile } = vi.hoisted(() => ({
  ensureJournalFile: vi.fn(),
}));
vi.mock("../../services/journal-file-service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../services/journal-file-service")
  >()),
  ensureJournalFile,
}));

const realPlatform = navigator.platform;

/** A journal date file is the active tab — the state the removed §56b branch keyed on. */
function openJournalDateFile() {
  useSettingsStore.setState({
    journalDirectory: "/vault/journal",
    journalEnabled: true,
  });
  useEditorStore.setState({
    activeTabId: "t1",
    tabs: [{ filePath: "/vault/journal/2026-09-24.md", id: "t1" }] as never,
  });
}

function press(target: Element, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(e);
  return e;
}

function setPlatform(platform: string) {
  Object.defineProperty(navigator, "platform", {
    configurable: true,
    value: platform,
  });
}

const altArrow = (target: Element, key: "ArrowLeft" | "ArrowRight") =>
  press(target, { altKey: true, code: key, key });

let handleGoBack: Mock<() => void>;
let handleGoForward: Mock<() => void>;
let host: HTMLElement;
let editor: Editor;
let input: HTMLInputElement;
const initialSettings = useSettingsStore.getState();
const initialEditor = useEditorStore.getState();

beforeEach(() => {
  ensureJournalFile.mockClear();
  handleGoBack = vi.fn();
  handleGoForward = vi.fn();
  renderHook(() =>
    useGlobalKeyboard({
      editor: null,
      findReplaceOpen: false,
      handleGoBack,
      handleGoForward,
      isSourceMode: false,
      setTabSwitcherIndex: vi.fn(),
      setTabSwitcherOpen: vi.fn(),
      tabSwitcherMruRef: { current: [] },
      tabSwitcherOpen: false,
    }),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  editor = new Editor({
    content: "<p>hello world</p>",
    element: host,
    extensions: createBaramExtensions(),
  });
  input = document.createElement("input");
  input.value = "hello world";
  document.body.appendChild(input);
});

afterEach(() => {
  editor.destroy();
  host.remove();
  input.remove();
  setPlatform(realPlatform);
  useSettingsStore.setState({
    journalDirectory: initialSettings.journalDirectory,
    journalEnabled: initialSettings.journalEnabled,
  });
  useEditorStore.setState({
    activeTabId: initialEditor.activeTabId,
    tabs: initialEditor.tabs,
  });
});

const targets = [
  ["the editor", () => editor.view.dom],
  ["an <input>", () => input],
] as const;

describe("§37 Option+←/→ on macOS — left to the text field", () => {
  beforeEach(() => setPlatform("MacIntel"));

  describe.each(targets)("in %s", (_, target) => {
    it.each(["ArrowLeft", "ArrowRight"] as const)(
      "Option+%s neither navigates nor cancels the caret move",
      (key) => {
        const e = altArrow(target(), key);
        expect(handleGoBack).not.toHaveBeenCalled();
        expect(handleGoForward).not.toHaveBeenCalled();
        expect(e.defaultPrevented).toBe(false);
      },
    );
  });

  it("does not claim Option+← in a journal date file either", () => {
    openJournalDateFile();
    const e = altArrow(editor.view.dom, "ArrowLeft");
    expect(handleGoBack).not.toHaveBeenCalled();
    expect(ensureJournalFile).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("still navigates on ⌃- and ⌃⇧-", () => {
    const back = press(editor.view.dom, {
      code: "Minus",
      ctrlKey: true,
      key: "-",
    });
    const forward = press(editor.view.dom, {
      code: "Minus",
      ctrlKey: true,
      key: "_",
      shiftKey: true,
    });
    expect(handleGoBack).toHaveBeenCalledTimes(1);
    expect(handleGoForward).toHaveBeenCalledTimes(1);
    expect([back.defaultPrevented, forward.defaultPrevented]).toEqual([
      true,
      true,
    ]);
  });
});

describe.each(["Win32", "Linux x86_64"])(
  "§37 Alt+←/→ on %s — back and forward",
  (platform) => {
    beforeEach(() => setPlatform(platform));

    describe.each(targets)("in %s", (_, target) => {
      it("Alt+← goes back and Alt+→ goes forward", () => {
        const left = altArrow(target(), "ArrowLeft");
        const right = altArrow(target(), "ArrowRight");
        expect(handleGoBack).toHaveBeenCalledTimes(1);
        expect(handleGoForward).toHaveBeenCalledTimes(1);
        expect([left.defaultPrevented, right.defaultPrevented]).toEqual([
          true,
          true,
        ]);
      });
    });

    it("goes back from a journal date file too, not to the previous day", () => {
      openJournalDateFile();
      altArrow(editor.view.dom, "ArrowLeft");
      expect(handleGoBack).toHaveBeenCalledTimes(1);
      expect(ensureJournalFile).not.toHaveBeenCalled();
    });
  },
);
