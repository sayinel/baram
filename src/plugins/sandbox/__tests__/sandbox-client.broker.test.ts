import type { PluginOp } from "../plugin-op";
import type { SandboxContext } from "../sandbox-client";

import { describe, expect, it, vi } from "vitest";

import { startSandboxClient } from "../sandbox-client";
import { SandboxSession } from "../sandbox-session";
import { createChannelPair } from "./channel-pair";

// §260 Phase 3c-1 — the sandbox context's storage/network APIs must route through
// the injected broker (which, in production, is `plugin_call`). The Rust
// authorizer is the real per-call gate; these tests assert only the op shapes the
// broker receives, mirroring the Rust `PluginOp` serde contract.
describe("startSandboxClient broker (§260 storage/network)", () => {
  it("routes ctx.storage through the broker with exact op shapes", async () => {
    const ops: PluginOp[] = [];
    const broker = vi.fn(async (op: PluginOp) => {
      ops.push(op);
      if (op.kind === "source_read") return "// bundle";
      return op.kind === "storage_read"
        ? "v"
        : op.kind === "storage_list"
          ? ["k"]
          : undefined;
    });
    const { host, sandbox } = createChannelPair();
    let readResult: unknown;
    let listResult: unknown;
    startSandboxClient(
      sandbox,
      async () => ({
        activate: async (ctx: SandboxContext) => {
          await ctx.storage.write("k", "v");
          readResult = await ctx.storage.read("k");
          listResult = await ctx.storage.list();
          await ctx.storage.remove("k");
        },
      }),
      broker,
    );
    const s = new SandboxSession(host);
    await s.activate("p", { commands: [] });

    expect(ops.filter((o) => o.kind !== "source_read")).toEqual([
      { kind: "storage_write", key: "k", value: "v" },
      { kind: "storage_read", key: "k" },
      { kind: "storage_list" },
      { kind: "storage_remove", key: "k" },
    ]);
    expect(readResult).toBe("v");
    expect(listResult).toEqual(["k"]);
  });

  it("routes ctx.network.fetch through the broker as http_fetch", async () => {
    const ops: PluginOp[] = [];
    const broker = vi.fn(async (op: PluginOp) => {
      ops.push(op);
      if (op.kind === "source_read") return "// bundle";
      return { body: "", headers: {}, status: 200 };
    });
    const { host, sandbox } = createChannelPair();
    startSandboxClient(
      sandbox,
      async () => ({
        activate: async (ctx: SandboxContext) => {
          await ctx.network.fetch("https://x.test", { method: "GET" });
        },
      }),
      broker,
    );
    const s = new SandboxSession(host);
    await s.activate("p", { commands: [] });

    expect(ops.filter((o) => o.kind !== "source_read")).toEqual([
      { kind: "http_fetch", url: "https://x.test", init: { method: "GET" } },
    ]);
  });
});
