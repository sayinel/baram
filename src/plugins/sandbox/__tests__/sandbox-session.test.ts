import type { PluginContributions } from "../../types";
import type { HostToSandbox } from "../protocol";

import { describe, expect, it } from "vitest";

import { SandboxSession } from "../sandbox-session";
import { createChannelPair } from "./channel-pair";

const DECLARED: PluginContributions = { commands: [{ id: "c1", title: "C1" }] };
const REPORT = { commands: ["c1"], events: ["file:open"] };

describe("SandboxSession (§260 host router)", () => {
  it("activate() resolves with the DECLARED (manifest) contributions", async () => {
    const { host, sandbox } = createChannelPair();
    sandbox.onMessage((m: HostToSandbox) => {
      if (m.type === "activate")
        sandbox.send({ type: "ready", registered: REPORT });
    });
    const s = new SandboxSession(host);
    const rec = await s.activate("p", "u", DECLARED);
    expect(rec).toBe(DECLARED);
    expect(s.contributions).toBe(DECLARED);
  });

  it("activate() RETRIES until ready (survives a dropped first activate)", async () => {
    const { host, sandbox } = createChannelPair();
    let seen = 0;
    sandbox.onMessage((m: HostToSandbox) => {
      if (m.type === "activate" && ++seen >= 2)
        sandbox.send({ type: "ready", registered: REPORT });
    });
    const s = new SandboxSession(host);
    await expect(s.activate("p", "u", DECLARED)).resolves.toBe(DECLARED);
    expect(seen).toBeGreaterThanOrEqual(2);
  });

  it("activate() rejects on activateError", async () => {
    const { host, sandbox } = createChannelPair();
    sandbox.onMessage((m: HostToSandbox) => {
      if (m.type === "activate")
        sandbox.send({ type: "activateError", error: "boom" });
    });
    await expect(
      new SandboxSession(host).activate("p", "u", DECLARED),
    ).rejects.toThrow(/boom/);
  });

  it("invokeCommand() round-trips by callId", async () => {
    const { host, sandbox } = createChannelPair();
    sandbox.onMessage((m: HostToSandbox) => {
      if (m.type === "activate")
        sandbox.send({ type: "ready", registered: REPORT });
      if (m.type === "invokeCommand")
        sandbox.send({
          type: "callResult",
          callId: m.callId,
          ok: true,
          value: m.args[0],
        });
    });
    const s = new SandboxSession(host);
    await s.activate("p", "u", DECLARED);
    await expect(s.invokeCommand("c1", ["hi"])).resolves.toBe("hi");
  });

  it("invokeCommand() rejects on ok:false", async () => {
    const { host, sandbox } = createChannelPair();
    sandbox.onMessage((m: HostToSandbox) => {
      if (m.type === "activate")
        sandbox.send({ type: "ready", registered: REPORT });
      if (m.type === "invokeCommand")
        sandbox.send({
          type: "callResult",
          callId: m.callId,
          ok: false,
          error: "nope",
        });
    });
    const s = new SandboxSession(host);
    await s.activate("p", "u", DECLARED);
    await expect(s.invokeCommand("c1")).rejects.toThrow(/nope/);
  });

  it("onEmit() receives plugin→host events", async () => {
    const { host, sandbox } = createChannelPair();
    const s = new SandboxSession(host);
    const seen: Array<[string, unknown[]]> = [];
    s.onEmit((e, a) => seen.push([e, a]));
    sandbox.send({ type: "emitEvent", event: "hello", args: [1] });
    await Promise.resolve();
    expect(seen).toEqual([["hello", [1]]]);
  });

  it("dispose() sends deactivate and rejects pending calls", async () => {
    const { host, sandbox } = createChannelPair();
    const got: HostToSandbox[] = [];
    sandbox.onMessage((m: HostToSandbox) => {
      got.push(m);
      if (m.type === "activate")
        sandbox.send({ type: "ready", registered: REPORT });
    });
    const s = new SandboxSession(host);
    await s.activate("p", "u", DECLARED);
    const pending = s.invokeCommand("c1");
    s.dispose();
    await Promise.resolve();
    await expect(pending).rejects.toThrow(/disposed/i);
    expect(got.some((m) => m.type === "deactivate")).toBe(true);
  });
});
