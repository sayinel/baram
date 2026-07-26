// §260 Phase 3c-2a — the host end of the sandbox transport. Sends over the
// host-only `plugin_sandbox_send` command; receives the `plugin:s2h` event Rust
// re-emits, filtered to THIS plugin's id.
import type { SandboxToHost } from "../protocol";

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const listen = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listen(...args),
}));

import { createHostTransport } from "../tauri-host-transport";

let deliver: (payload: unknown) => void;
let unlisten: ReturnType<typeof vi.fn>;

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(undefined);
  unlisten = vi.fn();
  listen
    .mockReset()
    .mockImplementation(
      async (_event: string, handler: (e: { payload: unknown }) => void) => {
        deliver = (payload) => handler({ payload });
        return unlisten;
      },
    );
});

describe("createHostTransport (§260 host end)", () => {
  it("sends through the host-only plugin_sandbox_send command", async () => {
    const transport = await createHostTransport("alpha");
    transport.send({ type: "deactivate" });
    expect(invoke).toHaveBeenCalledWith("plugin_sandbox_send", {
      pluginId: "alpha",
      msg: { type: "deactivate" },
    });
  });

  it("delivers only s2h messages stamped with this plugin's id", async () => {
    const transport = await createHostTransport("alpha");
    const seen: SandboxToHost[] = [];
    transport.onMessage((m) => seen.push(m));

    deliver({ pluginId: "beta", msg: { type: "activateError", error: "no" } });
    expect(seen).toEqual([]); // another plugin's report must not leak in

    deliver({
      pluginId: "alpha",
      msg: { type: "ready", registered: { commands: [], events: [] } },
    });
    expect(seen).toEqual([
      { type: "ready", registered: { commands: [], events: [] } },
    ]);
  });

  it("ignores malformed payloads instead of throwing into the listener", async () => {
    const transport = await createHostTransport("alpha");
    const seen: SandboxToHost[] = [];
    transport.onMessage((m) => seen.push(m));
    expect(() => deliver(null)).not.toThrow();
    expect(() => deliver({ pluginId: "alpha" })).not.toThrow();
    expect(() => deliver("nonsense")).not.toThrow();
    expect(seen).toEqual([]);
  });

  it("swallows a rejected send — the sandbox may not have connected yet", async () => {
    const transport = await createHostTransport("alpha");
    invoke.mockRejectedValueOnce(new Error("sandbox is not connected"));
    expect(() => transport.send({ type: "deactivate" })).not.toThrow();
    // let the rejection settle; an unhandled rejection would fail the run
    await Promise.resolve();
    await Promise.resolve();
  });

  it("close() unlistens and stops delivering", async () => {
    const transport = await createHostTransport("alpha");
    const seen: SandboxToHost[] = [];
    transport.onMessage((m) => seen.push(m));
    transport.close();
    expect(unlisten).toHaveBeenCalled();
    deliver({ pluginId: "alpha", msg: { type: "activateError", error: "x" } });
    expect(seen).toEqual([]);
  });
});
