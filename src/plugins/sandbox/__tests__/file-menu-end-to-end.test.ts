// §395 spec 0074 D16 · §7 "계획 B" (호출) — a sandboxed plugin's file tree menu command, end to end through the
// loader (`prompt-end-to-end.test.ts`'s harness): the targets reach the handler and the palette's call hands
// none; 1,000 targets cross in one frame of 8,192 bytes or more, all of them; a command started from the menu
// may open a prompt (§385); and an argument JSON cannot carry is refused at once instead of waiting out the
// call's 30 s. `wire` models what plan 0128 R10 found — run: every host→sandbox frame crosses as JSON; read,
// not run: one that JSON cannot serialize makes `invoke` reject, which the send chain logs and drops.
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/plugin-invoke", () => ({
  pluginSandboxDeregister: vi.fn(async () => {}),
  pluginSandboxRegister: vi.fn(async () => {}),
  pluginSandboxStage: vi.fn(async () => {}),
}));

import type {
  FileMenuTarget,
  PluginManifest,
  SandboxContext,
} from "../../types";
import type { HostToSandbox } from "../protocol";

import { stubPromptLayout } from "../../../components/plugins/__tests__/prompt-layout";
import { fileTreePluginItems } from "../../../components/sidebar/file-tree-plugin-menu";
import { useContextStore } from "../../../stores/context/context";
import { createExtensionContext } from "../../extension-context";
import { livePluginEntrySource } from "../../plugin-entry-points";
import { executePluginCommand } from "../../plugin-host-registry";
import { PluginLoader } from "../../plugin-loader";
import { resetPromptGate } from "../../prompt-gate";
import { startSandboxClient } from "../sandbox-client";
import { SandboxHost } from "../sandbox-host";
import { createChannelPair } from "./channel-pair";

const manifest = {
  author: "t",
  capabilities: ["filetree"],
  description: "t",
  engines: { baram: ">=0.2.0" },
  id: "demo",
  license: "MIT",
  main: "index.mjs",
  name: "Demo",
  trust: "sandboxed",
  version: "1.0.0",
  contributions: {
    commands: [
      { id: "take", title: "Take" },
      { id: "pick", title: "Pick" },
    ],
    fileMenu: [
      { command: "take", id: "take" },
      { command: "pick", id: "pick" },
    ],
  },
} as unknown as PluginManifest;
/** Another plugin, trusted, to reach `demo`'s handlers through `ctx.commands.execute`. */
const caller = {
  ...manifest,
  capabilities: ["commands"],
  contributions: {},
  id: "other",
  name: "Other",
  trust: "trusted",
} as unknown as PluginManifest;

let calls: unknown[][] = [];
let frames: string[] = [];
let picked: unknown;
let loader: PluginLoader;

const targets = (n: number): FileMenuTarget[] =>
  Array.from({ length: n }, (_, i) => ({
    isDir: false,
    path: `/v/notes/note-${String(i).padStart(4, "0")}.md`,
  }));
/** Clicks the menu item `key` as the tree would, over `chosen`. */
function click(key: string, chosen: FileMenuTarget[]): void {
  const item = fileTreePluginItems(chosen, livePluginEntrySource()).find(
    (candidate) => candidate.key === key,
  );
  if (item === undefined || !("run" in item))
    throw new Error(`no runnable ${key}`);
  item.run();
}
const commandFrames = () =>
  frames
    .filter((f) => f.includes('"type":"invokeCommand"'))
    .map((f) => JSON.parse(f) as { args: unknown[] });

beforeEach(async () => {
  calls = [];
  frames = [];
  picked = undefined;
  useContextStore.setState({
    activeContextId: "ctx-1",
    contexts: [{ contextType: "vault", id: "ctx-1", path: "/v" }] as never,
  });
  const { host, sandbox } = createChannelPair();
  startSandboxClient(
    sandbox,
    async () => ({
      activate: (ctx: SandboxContext) => {
        ctx.commands.register("take", (...args: unknown[]) => {
          calls.push(args);
        });
        ctx.commands.register("pick", async () => {
          picked = await ctx.prompts.showQuickPick([
            { id: "a", label: "Alpha" },
            { id: "b", label: "Beta" },
          ]);
        });
      },
    }),
    async (op) => (op.kind === "source_read" ? "// bundle" : undefined),
  );
  const wire: typeof host = {
    close: () => host.close(),
    onMessage: (handler) => host.onMessage(handler),
    send: (frame) => {
      let json: string;
      try {
        json = JSON.stringify(frame);
      } catch {
        return; // `invoke` rejected; `createSendChain` logs it and goes on
      }
      frames.push(json);
      host.send(JSON.parse(json) as HostToSandbox);
    },
  };
  loader = new PluginLoader(
    undefined,
    new SandboxHost(() => ({ close: () => {}, transport: wire })),
  );
  await loader.loadPlugin("/p/demo", manifest);
});
afterEach(async () => {
  await loader.unloadPlugin("demo");
  resetPromptGate();
  document.body.innerHTML = "";
});

describe("a sandboxed file tree menu command, end to end (§395 D16)", () => {
  /** What fails this: the old wiring `() => session.invokeCommand(cmd.id)`, which dropped every argument. */
  it("hands the menu's targets to the handler; the palette's call hands none", async () => {
    click("demo:take", targets(2));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual([
      [
        { context: "ctx-1", isDir: false, path: "notes/note-0000.md" },
        { context: "ctx-1", isDir: false, path: "notes/note-0001.md" },
      ],
    ]);
    await executePluginCommand("demo.take"); // as the command palette calls it
    expect(calls[1]).toEqual([]);
    expect(commandFrames().map((f) => f.args.length)).toEqual([1, 0]);
  });

  /** What fails this: a size gate on `invokeCommand`, or a frame that loses part of its targets (D16, review r2-I1). */
  it("delivers 1,000 targets whole, in one frame of 8,192 bytes or more", async () => {
    click("demo:take", targets(1_000));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const got = calls[0][0] as { path: string }[];
    expect(got).toHaveLength(1_000);
    expect(got[999]).toEqual({
      context: "ctx-1",
      isDir: false,
      path: "notes/note-0999.md",
    });
    const [frame] = frames.filter((f) => f.includes('"type":"invokeCommand"'));
    expect(new TextEncoder().encode(frame ?? "").length).toBeGreaterThanOrEqual(
      8_192,
    );
  });

  /** What fails this: a menu that runs the handler itself — no rights, and the prompt is refused (§385). */
  it("§385 — a command started from the menu may open a prompt; started by another plugin, it may not", async () => {
    const restore = stubPromptLayout();
    try {
      click("demo:pick", targets(1));
      await vi.waitFor(() =>
        expect(document.querySelector(".plugin-prompt-input")).not.toBeNull(),
      );
      const input = document.querySelector<HTMLInputElement>(
        ".plugin-prompt-input",
      )!;
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });
      await vi.waitFor(() => expect(picked).toBe("b"));
      const other = createExtensionContext(caller, "/p/other");
      await expect(other.commands.execute("demo.pick")).rejects.toThrow(
        /commands is running/,
      );
    } finally {
      restore();
    }
  });

  /**
   * What fails this: no check in `invokeCommand` — the BigInt and the cycle are dropped by `wire` as tauri's
   * `invoke` drops them, and the call waits out `CALL_TIMEOUT_MS` (30 s, past this test's 5 s); the function
   * arrives as `null`.
   */
  it("refuses at once an argument JSON cannot carry, from another plugin's commands.execute; a plain one goes", async () => {
    const other = createExtensionContext(caller, "/p/other");
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const bad of [1n, () => 1, cycle]) {
      await expect(other.commands.execute("demo.take", bad)).rejects.toThrow(
        'Sandbox command "take" was not sent: an argument holds a function, a BigInt or a cycle',
      );
    }
    expect(calls).toEqual([]);
    await other.commands.execute("demo.take", [{ path: "a.md" }]);
    expect(calls).toEqual([[[{ path: "a.md" }]]]);
  });
});
