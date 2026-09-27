// §385 spec 0061 §11 — a trusted command launched with Enter in the REAL palette, prompting
// after the next task. The watcher must be capture-phase: in bubble phase the launching Enter is
// counted after the invocation starts, and both tests below go red. A synchronous request would
// NOT show that — it runs before the window's bubble listener either way.
import type { PluginManifest } from "../../../plugins/types";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createExtensionContext } from "../../../plugins/extension-context";
import { usePluginUIStore } from "../../../plugins/plugin-ui-store";
import { resetPromptGate } from "../../../plugins/prompt-gate";
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

afterEach(() => {
  resetPromptGate();
  usePluginUIStore.setState({ paletteCommands: [] });
  document.body.innerHTML = "";
});

function launch(
  handler: (ctx: ReturnType<typeof createExtensionContext>) => Promise<unknown>,
) {
  const ctx = createExtensionContext(manifest, "/p");
  const result = vi.fn();
  ctx.commands.register("go", () => handler(ctx).then(result, result), {
    title: "Zqx probe",
  });
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
  fireEvent.keyDown(paletteInput, { key: "Enter" }); // bubbles, like the real key
  return result;
}

const promptInput = () =>
  document.querySelector<HTMLInputElement>(".plugin-prompt-input");
const nextTask = () => new Promise((r) => setTimeout(r, 0));

describe("prompting from a palette-launched command", () => {
  it("opens a prompt the handler asks for after the next task", async () => {
    const restore = stubPromptLayout();
    const result = launch(async (ctx) => {
      await nextTask();
      return ctx.prompts.showQuickPick([{ id: "a", label: "A" }]);
    });
    await vi.waitFor(() => expect(promptInput()).not.toBeNull());
    act(() => void fireEvent.keyDown(promptInput()!, { key: "Enter" }));
    await vi.waitFor(() => expect(result).toHaveBeenCalledWith("a"));
    restore();
  });

  it("opens the second prompt of a flow after a pick in the first", async () => {
    const restore = stubPromptLayout();
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
    restore();
  });
});
