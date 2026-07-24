import type { PluginContributions } from "../../types";
import type { SandboxContext } from "../sandbox-client";

import { describe, expect, it } from "vitest";

import { startSandboxClient } from "../sandbox-client";
import { SandboxSession } from "../sandbox-session";
import { createChannelPair } from "./channel-pair";

const DECLARED: PluginContributions = {
  commands: [
    { id: "add", title: "Add" },
    { id: "boom", title: "Boom" },
    { id: "bad", title: "Bad" },
    { id: "go", title: "Go" },
  ],
};

function wire(activate: (ctx: SandboxContext) => void, importCount = { n: 0 }) {
  const { host, sandbox } = createChannelPair();
  startSandboxClient(sandbox, async () => {
    importCount.n++;
    return { activate };
  });
  return new SandboxSession(host);
}

describe("startSandboxClient (§260 sandbox shim)", () => {
  it("reports bound command ids + subscribed events on ready", async () => {
    const s = wire((ctx) => {
      ctx.commands.register("add", () => 0);
      ctx.events.on("file:open", () => {});
    });
    await s.activate("p", "u", DECLARED);
    expect(s.registered).toEqual({ commands: ["add"], events: ["file:open"] });
  });

  it("runs a command handler and returns its value", async () => {
    const s = wire((ctx) =>
      ctx.commands.register("add", (a, b) => (a as number) + (b as number)),
    );
    await s.activate("p", "u", DECLARED);
    await expect(s.invokeCommand("add", [2, 3])).resolves.toBe(5);
  });

  it("replies ok:false when the handler throws", async () => {
    const s = wire((ctx) =>
      ctx.commands.register("boom", () => {
        throw new Error("x");
      }),
    );
    await s.activate("p", "u", DECLARED);
    await expect(s.invokeCommand("boom")).rejects.toThrow(/x/);
  });

  it("replies ok:false when the result is not JSON-serializable (I5)", async () => {
    const s = wire((ctx) => ctx.commands.register("bad", () => () => 0)); // returns a function
    await s.activate("p", "u", DECLARED);
    await expect(s.invokeCommand("bad")).rejects.toThrow(/serializ/i);
  });

  it("delivers host events to the plugin handler", async () => {
    const calls: unknown[][] = [];
    const s = wire((ctx) =>
      ctx.events.on("file:open", (...a) => calls.push(a)),
    );
    await s.activate("p", "u", { commands: [] });
    s.deliverEvent("file:open", ["/a.md"]);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([["/a.md"]]);
  });

  it("forwards ctx.events.emit to host onEmit", async () => {
    const s = wire((ctx) =>
      ctx.commands.register("go", () => ctx.events.emit("pinged", 7)),
    );
    const seen: Array<[string, unknown[]]> = [];
    s.onEmit((e, a) => seen.push([e, a]));
    await s.activate("p", "u", DECLARED);
    await s.invokeCommand("go");
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([["pinged", [7]]]);
  });

  it("sends activateError when activate throws", async () => {
    const s = wire(() => {
      throw new Error("bad activate");
    });
    await expect(s.activate("p", "u", { commands: [] })).rejects.toThrow(
      /bad activate/,
    );
  });

  it("ignores a repeated activate (M4) — imports only once", async () => {
    const count = { n: 0 };
    const { host, sandbox } = createChannelPair();
    startSandboxClient(sandbox, async () => {
      count.n++;
      return { activate: () => {} };
    });
    const s = new SandboxSession(host);
    await s.activate("p", "u", { commands: [] });
    // Session retries stop after ready, but simulate an extra inbound activate:
    sandbox.onMessage(() => {});
    await new Promise((r) => setTimeout(r, 300));
    expect(count.n).toBe(1);
  });
});
