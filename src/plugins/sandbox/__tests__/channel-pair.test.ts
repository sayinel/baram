import { describe, expect, it, vi } from "vitest";

import { createChannelPair } from "./channel-pair";

describe("createChannelPair (§260 sandbox test transport)", () => {
  it("delivers host.send to the sandbox handler", async () => {
    const { host, sandbox } = createChannelPair();
    const seen: unknown[] = [];
    sandbox.onMessage((m) => seen.push(m));
    host.send({ type: "deactivate" });
    await Promise.resolve();
    expect(seen).toEqual([{ type: "deactivate" }]);
  });

  it("delivers sandbox.send to the host handler", async () => {
    const { host, sandbox } = createChannelPair();
    const seen: unknown[] = [];
    host.onMessage((m) => seen.push(m));
    sandbox.send({ type: "ready", registered: { commands: [], events: [] } });
    await Promise.resolve();
    expect(seen).toEqual([
      { type: "ready", registered: { commands: [], events: [] } },
    ]);
  });

  it("stops delivering after unsubscribe", async () => {
    const { host, sandbox } = createChannelPair();
    const fn = vi.fn();
    sandbox.onMessage(fn)();
    host.send({ type: "deactivate" });
    await Promise.resolve();
    expect(fn).not.toHaveBeenCalled();
  });
});
