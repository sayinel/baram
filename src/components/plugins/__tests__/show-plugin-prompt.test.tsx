// §385 spec 0061 §8 — the window: one at a time, every exit settles once and hands focus back,
// nothing covered takes focus, IME and held keys do not pick, handled keys stay inside.
import { act, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const focusEditorView = vi.fn();
const surface = { blocked: null as null | string };
vi.mock("../../../utils/editor/focus-editor-view", () => ({
  focusEditorView: (view: unknown) => focusEditorView(view),
}));
vi.mock("../../../plugins/plugin-host-registry", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  editorSurfaceBlocked: () => surface.blocked,
  getEditorInstance: () => ({ view: "the-view" }),
}));

import {
  beginPluginInvocation,
  clearPromptGate,
  promptRefusal,
  resetPromptGate,
} from "../../../plugins/prompt-gate";
import { useUIStore } from "../../../stores/ui/ui";
import { PromptOccludedError, showPluginPrompt } from "../show-plugin-prompt";
import { stubPromptLayout } from "./prompt-layout";

const input = () =>
  document.querySelector<HTMLInputElement>(".plugin-prompt-input")!;
const overlay = () => document.querySelector(".plugin-prompt-overlay");
const pick = (n: number) =>
  showPluginPrompt("p", "Word Count", {
    items: Array.from({ length: n }, (_, i) => ({
      id: `id-${i}`,
      label: `Item ${i}`,
    })),
    kind: "quickPick",
  });

let restoreLayout: () => void;
beforeEach(() => {
  restoreLayout = stubPromptLayout();
  surface.blocked = null;
  useUIStore.setState({ commandPaletteOpen: false, quickSwitcherOpen: false });
});
afterEach(() => {
  restoreLayout();
  resetPromptGate();
  focusEditorView.mockClear();
  document.body.innerHTML = "";
});

describe("showPluginPrompt", () => {
  it("draws at most 50 rows, with the host's prefix before the plugin's name", async () => {
    const answer = pick(60);
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(50);
    expect(overlay()?.textContent).toContain("Plugin · Word Count");
    act(() => void fireEvent.keyDown(input(), { key: "Escape" }));
    await expect(answer).resolves.toBeUndefined();
  });

  it.each([
    [
      "Enter",
      (): void => void fireEvent.keyDown(input(), { key: "Enter" }),
      "id-0",
    ],
    [
      "Escape",
      (): void => void fireEvent.keyDown(input(), { key: "Escape" }),
      undefined,
    ],
    [
      "a mousedown outside",
      (): void => void fireEvent.mouseDown(overlay()!),
      undefined,
    ],
    [
      "the palette opening",
      (): void => useUIStore.setState({ commandPaletteOpen: true }),
      undefined,
    ],
    [
      "the quick switcher opening",
      (): void => useUIStore.setState({ quickSwitcherOpen: true }),
      undefined,
    ],
    ["teardown", (): void => clearPromptGate("p"), undefined],
  ])(
    "settles once on %s, removes itself and hands focus back",
    async (_exit, exit, expected) => {
      const origin = document.body.appendChild(
        document.createElement("button"),
      );
      origin.focus();
      const answer = pick(3);
      expect(document.activeElement).toBe(input());
      act(exit);
      await expect(answer).resolves.toBe(expected);
      expect(overlay()).toBeNull();
      expect(document.activeElement).toBe(origin);
      // The slot is free again. Checked with a live invocation so the refusal cannot come from
      // condition 1 (no command running) before it ever reaches condition 3 (a prompt open).
      beginPluginInvocation("x");
      expect(promptRefusal("x")).toBeNull();
    },
  );

  it("returns focus to the editor when it came from <body>, unless the surface is blocked", async () => {
    let answer = pick(1);
    act(() => void fireEvent.keyDown(input(), { key: "Escape" }));
    await answer;
    expect(focusEditorView).toHaveBeenCalledWith("the-view");
    surface.blocked = "source mode";
    focusEditorView.mockClear();
    answer = pick(1);
    act(() => void fireEvent.keyDown(input(), { key: "Escape" }));
    await answer;
    expect(focusEditorView).not.toHaveBeenCalled();
  });

  it("refuses without taking focus when something covers the input", async () => {
    restoreLayout();
    const cover = document.body.appendChild(document.createElement("div"));
    restoreLayout = stubPromptLayout(() => cover);
    const origin = document.body.appendChild(document.createElement("button"));
    origin.focus();
    await expect(pick(1)).rejects.toBeInstanceOf(PromptOccludedError);
    expect(overlay()).toBeNull();
    expect(document.activeElement).toBe(origin);
  });

  it("counts an input with no box as covered", async () => {
    restoreLayout();
    const hit = vi
      .spyOn(document, "elementFromPoint")
      .mockImplementation(() => input());
    await expect(pick(1)).rejects.toBeInstanceOf(PromptOccludedError); // jsdom's 0×0 box
    hit.mockRestore();
    restoreLayout = stubPromptLayout();
  });

  it("ignores Enter and Escape while an IME is composing", async () => {
    const answer = pick(2);
    act(
      () =>
        void fireEvent.keyDown(input(), { isComposing: true, key: "Enter" }),
    );
    act(() => void fireEvent.keyDown(input(), { key: "Escape", keyCode: 229 }));
    expect(overlay()).not.toBeNull();
    act(() => void fireEvent.keyDown(input(), { key: "Enter" }));
    await expect(answer).resolves.toBe("id-0");
  });

  it("ignores a held key until a fresh one is pressed inside", async () => {
    const answer = pick(2);
    act(() => void fireEvent.keyDown(input(), { key: "Enter", repeat: true }));
    expect(overlay()).not.toBeNull();
    act(() => void fireEvent.keyDown(input(), { key: "ArrowDown" }));
    act(() => void fireEvent.keyDown(input(), { key: "Enter", repeat: true }));
    await expect(answer).resolves.toBe("id-1");
  });

  it("keeps the keys it handles from the page, and lets the others through", async () => {
    const seen = vi.fn();
    const listen = (e: KeyboardEvent) => seen(e.key);
    document.addEventListener("keydown", listen);
    const answer = pick(2);
    act(() => void fireEvent.keyDown(input(), { key: "ArrowDown" }));
    act(() => void fireEvent.keyDown(input(), { key: "Tab" }));
    act(() => void fireEvent.keyDown(input(), { key: "a" }));
    expect(seen.mock.calls.map(([k]) => k)).toEqual(["a"]);
    act(() => void fireEvent.keyDown(input(), { key: "Escape" }));
    await answer;
    document.removeEventListener("keydown", listen);
  });

  it("filters and ranks as the user types", async () => {
    const answer = showPluginPrompt("p", "P", {
      items: [
        { description: "meeting", id: "d", label: "Daily" },
        { id: "m", label: "Meeting" },
      ],
      kind: "quickPick",
    });
    act(() => void fireEvent.change(input(), { target: { value: "meet" } }));
    const labels = [
      ...document.querySelectorAll('[role="option"] .command-item-label'),
    ].map((n) => n.textContent);
    expect(labels).toEqual(["Meeting", "Daily"]);
    act(() => void fireEvent.keyDown(input(), { key: "Escape" }));
    await answer;
  });

  it("submits an input box with Enter, and refuses to submit past 1,000 characters", async () => {
    const answer = showPluginPrompt("p", "P", {
      kind: "inputBox",
      value: "draft",
    });
    expect(input().value).toBe("draft");
    expect(input().maxLength).toBe(1000);
    act(
      () =>
        void fireEvent.change(input(), { target: { value: "x".repeat(1001) } }),
    );
    act(() => void fireEvent.keyDown(input(), { key: "Enter" }));
    expect(overlay()?.querySelector('[role="alert"]')).not.toBeNull();
    act(() => void fireEvent.change(input(), { target: { value: "title" } }));
    act(() => void fireEvent.keyDown(input(), { key: "Enter" }));
    await expect(answer).resolves.toBe("title");
  });
});
