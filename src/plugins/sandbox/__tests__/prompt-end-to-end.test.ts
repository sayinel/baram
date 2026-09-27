// §385 spec 0061 §11 — the only automated check that the owner recorded at the SANDBOXED
// registration site (`wireSandboxContributions`) is right. With a wrong owner every sandboxed
// prompt is refused, and no unit test above sees it. Declares NO capability on purpose (D2).
import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/plugin-invoke", () => ({
  pluginSandboxDeregister: vi.fn(async () => {}),
  pluginSandboxRegister: vi.fn(async () => {}),
  pluginSandboxStage: vi.fn(async () => {}),
}));

import type { PluginManifest, SandboxContext } from "../../types";

import { stubPromptLayout } from "../../../components/plugins/__tests__/prompt-layout";
import { executePluginCommand } from "../../plugin-host-registry";
import { PluginLoader } from "../../plugin-loader";
import { resetPromptGate } from "../../prompt-gate";
import { startSandboxClient } from "../sandbox-client";
import { SandboxHost } from "../sandbox-host";
import { createChannelPair } from "./channel-pair";

const manifest = {
  author: "t",
  capabilities: [],
  contributions: { commands: [{ id: "pick", title: "Pick" }] },
  description: "t",
  engines: { baram: ">=0.2.0" },
  id: "demo",
  license: "MIT",
  main: "index.mjs",
  name: "Demo",
  trust: "sandboxed",
  version: "1.0.0",
} as unknown as PluginManifest;

afterEach(() => {
  resetPromptGate();
  document.body.innerHTML = "";
});

describe("a sandboxed prompt, end to end through the loader", () => {
  it("opens from a user command and returns the pick to the plugin", async () => {
    const restore = stubPromptLayout();
    try {
      const { host, sandbox } = createChannelPair();
      startSandboxClient(
        sandbox,
        async () => ({
          activate: (ctx: SandboxContext) =>
            ctx.commands.register("pick", () =>
              ctx.prompts.showQuickPick([
                { id: "a", label: "Alpha" },
                { id: "b", label: "Beta" },
              ]),
            ),
        }),
        async (op) => (op.kind === "source_read" ? "// bundle" : undefined),
      );
      const loader = new PluginLoader(
        undefined,
        new SandboxHost(() => ({ close: () => {}, transport: host })),
      );
      await loader.loadPlugin("/p/demo", manifest);

      try {
        const result = executePluginCommand("demo.pick");
        await vi.waitFor(() =>
          expect(document.querySelector(".plugin-prompt-input")).not.toBeNull(),
        );
        const input = document.querySelector<HTMLInputElement>(
          ".plugin-prompt-input",
        )!;
        fireEvent.keyDown(input, { key: "ArrowDown" });
        fireEvent.keyDown(input, { key: "Enter" });
        await expect(result).resolves.toBe("b");
      } finally {
        // A failed assertion above must still unload the sandboxed plugin — otherwise its
        // teardown never runs and a later test in the same file inherits a live session.
        await loader.unloadPlugin("demo");
      }
    } finally {
      restore();
    }
  });
});
