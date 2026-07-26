// §260 Phase 3c-2a — the sandbox end of the transport. Inbound messages arrive
// on an `ipc::Channel` the sandbox hands to Rust once at boot (point-to-point,
// never an event); outbound goes through `plugin_sandbox_report`.
import type { HostToSandbox } from "../protocol";

import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();

// `vi.mock` factories are hoisted above module scope, so the stand-in class has
// to be hoisted with them. Stand-in for `@tauri-apps/api/core`'s Channel — the
// real one wires a callback id through `transformCallback` (Tauri internals).
const { FakeChannel } = vi.hoisted(() => {
  class FakeChannel<T> {
    onmessage: (msg: T) => void = () => {};
    toJSON(): string {
      return "__CHANNEL__:1";
    }
  }
  return { FakeChannel };
});

vi.mock("@tauri-apps/api/core", () => ({
  Channel: FakeChannel,
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { createSandboxTransport } from "../tauri-sandbox-transport";

beforeEach(() => {
  invoke.mockReset().mockResolvedValue(undefined);
});

/** The hoisted stand-in is a value binding, so describe its shape structurally. */
interface ChannelLike {
  onmessage: (msg: HostToSandbox) => void;
}

/** The channel instance the transport handed to `plugin_sandbox_connect`. */
function connectedChannel(): ChannelLike {
  const call = invoke.mock.calls.find((c) => c[0] === "plugin_sandbox_connect");
  expect(call).toBeDefined();
  return (call?.[1] as { channel: ChannelLike }).channel;
}

describe("createSandboxTransport (§260 sandbox end)", () => {
  it("registers its inbound channel exactly once, before resolving", async () => {
    await createSandboxTransport();
    const connects = invoke.mock.calls.filter(
      (c) => c[0] === "plugin_sandbox_connect",
    );
    expect(connects).toHaveLength(1);
    expect(connectedChannel()).toBeInstanceOf(FakeChannel);
  });

  it("delivers channel messages to onMessage handlers", async () => {
    const transport = await createSandboxTransport();
    const seen: HostToSandbox[] = [];
    const off = transport.onMessage((m) => seen.push(m));

    connectedChannel().onmessage({
      type: "activate",
      pluginId: "alpha",
      pluginUrl: "asset://x",
    });
    expect(seen).toEqual([
      { type: "activate", pluginId: "alpha", pluginUrl: "asset://x" },
    ]);

    off();
    connectedChannel().onmessage({ type: "deactivate" });
    expect(seen).toHaveLength(1);
  });

  it("sends through plugin_sandbox_report (no caller-supplied plugin id)", async () => {
    const transport = await createSandboxTransport();
    transport.send({ type: "emitEvent", event: "e", args: [1] });
    expect(invoke).toHaveBeenCalledWith("plugin_sandbox_report", {
      msg: { type: "emitEvent", event: "e", args: [1] },
    });
  });

  it("swallows a rejected report so plugin code cannot crash on the wire", async () => {
    const transport = await createSandboxTransport();
    invoke.mockRejectedValueOnce(new Error("denied"));
    expect(() =>
      transport.send({ type: "emitEvent", event: "e", args: [] }),
    ).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it("close() stops delivering", async () => {
    const transport = await createSandboxTransport();
    const seen: HostToSandbox[] = [];
    transport.onMessage((m) => seen.push(m));
    transport.close();
    connectedChannel().onmessage({ type: "deactivate" });
    expect(seen).toEqual([]);
  });
});
