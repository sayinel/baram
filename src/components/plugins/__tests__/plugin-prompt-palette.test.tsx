// §385 spec 0061 §11 — a trusted command launched with Enter in the REAL palette, prompting
// after the next task. The watcher must be capture-phase: in bubble phase the launching Enter is
// counted after the invocation starts, and both tests below go red. A synchronous request would
// NOT show that — it runs before the window's bubble listener either way.
import type { Disposable, PluginManifest } from "../../../plugins/types";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createExtensionContext } from "../../../plugins/extension-context";
import { usePluginUIStore } from "../../../plugins/plugin-ui-store";
import {
  beginPluginInvocation,
  clearPromptGate,
  resetPromptGate,
} from "../../../plugins/prompt-gate";
import { useUIStore } from "../../../stores/ui/ui";
import { CommandPalette } from "../../command/CommandPalette";
import { stubPromptLayout } from "./prompt-layout";

const noop = () => {};
const manifest = {
  author: "t",
  capabilities: ["commands"],
  description: "t",
  engines: { baram: ">=0.2.0" },
  id: "probe",
  license: "MIT",
  main: "index.mjs",
  name: "Probe",
  trust: "trusted",
  version: "1.0.0",
} as unknown as PluginManifest;

// A failed assertion must not leak the layout stub, the "go" command handler or an open prompt
// into the next row: all three are torn down here, not at the end of each `it`, so they come
// down even when the test body throws first. The prompt is CLOSED (`clearPromptGate`), not just
// forgotten — `resetPromptGate` alone would leave its React root and its `useUIStore`
// subscription alive past the test.
let restoreLayout: (() => void) | null = null;
let goCommand: Disposable | null = null;

afterEach(() => {
  clearPromptGate(manifest.id);
  restoreLayout?.();
  restoreLayout = null;
  goCommand?.dispose();
  goCommand = null;
  resetPromptGate();
  usePluginUIStore.setState({ paletteCommands: [] });
  document.body.innerHTML = "";
});

function launch(
  handler: (ctx: ReturnType<typeof createExtensionContext>) => Promise<unknown>,
) {
  const ctx = createExtensionContext(manifest, "/p");
  const result = vi.fn();
  goCommand = ctx.commands.register(
    "go",
    () => handler(ctx).then(result, result),
    { title: "Zqx probe" },
  );
  useUIStore.setState({ commandPaletteOpen: true });
  render(
    <CommandPalette
      editor={null}
      onCloseFolder={noop}
      onNewFile={noop}
      onOpenFile={noop}
      onOpenFolder={noop}
      onSave={noop}
      onToggleSourceMode={noop}
    />,
  );
  const paletteInput = screen.getByPlaceholderText("Type a command...");
  fireEvent.change(paletteInput, { target: { value: "Zqx probe" } });
  // Bubbles, like the real key. `false` = default prevented: the launching Enter must add no
  // input AFTER the rights begin, and a `beforeinput` would (the watcher counts those). Our half
  // is that `usePaletteListNav` cancels this `keydown`; the browser's half — no `beforeinput`
  // follows a cancelled `keydown`, a UI Events rule the app relies on — is checked by hand, by
  // the sandbox-smoke README's steps that launch from the palette.
  expect(fireEvent.keyDown(paletteInput, { key: "Enter" })).toBe(false);
  return result;
}

const promptInput = () =>
  document.querySelector<HTMLInputElement>(".plugin-prompt-input");
const nextTask = () => new Promise((r) => setTimeout(r, 0));

describe("prompting from a palette-launched command", () => {
  it("opens a prompt the handler asks for after the next task — watcher already installed", async () => {
    // The app's steady state: some earlier plugin invocation already installed the capture-phase
    // watcher (`watchInput`, idempotent past its first call) and has since ended. This row does
    // NOT install it for the first time itself, unlike the row below.
    beginPluginInvocation("other")();
    restoreLayout = stubPromptLayout();
    const result = launch(async (ctx) => {
      await nextTask();
      return ctx.prompts.showQuickPick([{ id: "a", label: "A" }]);
    });
    await vi.waitFor(() => expect(promptInput()).not.toBeNull());
    act(() => void fireEvent.keyDown(promptInput()!, { key: "Enter" }));
    await vi.waitFor(() => expect(result).toHaveBeenCalledWith("a"));
  });

  it("opens the second prompt of a flow after a pick in the first", async () => {
    restoreLayout = stubPromptLayout();
    const result = launch(async (ctx) => {
      await nextTask();
      const picked = await ctx.prompts.showQuickPick([{ id: "a", label: "A" }]);
      return `${picked}:${await ctx.prompts.showInputBox({ value: "t" })}`;
    });
    await vi.waitFor(() => expect(promptInput()).not.toBeNull());
    act(() => void fireEvent.keyDown(promptInput()!, { key: "Enter" }));
    await vi.waitFor(() => expect(promptInput()?.value).toBe("t"));
    act(() => void fireEvent.keyDown(promptInput()!, { key: "Enter" }));
    await vi.waitFor(() => expect(result).toHaveBeenCalledWith("a:t"));
  });
});
