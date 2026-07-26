import type { AIAPI } from "../../types";
import type { PluginOp } from "../plugin-op";
import type { SandboxContext } from "../sandbox-client";

import { describe, expect, it } from "vitest";

import { createHostRequestHandler } from "../host-ai-bridge";
import { startSandboxClient } from "../sandbox-client";
import { SandboxSession } from "../sandbox-session";
import { createChannelPair } from "./channel-pair";

// §260 3c-2c code review — every other suite tests ONE half against a hand-rolled
// peer, so a field mismatch between the two real halves (a renamed `hostStreamToken`,
// a `requestId` that stops being echoed) would pass everywhere and fail only in the
// live smoke. This pairs the real `SandboxSession`, the real `startSandboxClient`, and
// the real `createHostRequestHandler`, with only the LLM itself faked.
describe("ai end-to-end: real client ↔ real session (§260 3c-2c)", () => {
  const broker = async (op: PluginOp) =>
    op.kind === "source_read" ? "// bundle" : undefined;

  /** Boots both halves and returns the sandbox-side context. */
  async function pair(capabilities: ("ai" | "storage")[], ai: AIAPI) {
    const { host, sandbox } = createChannelPair();
    let ctx: SandboxContext | undefined;
    startSandboxClient(
      sandbox,
      async () => ({
        activate: (c: SandboxContext) => {
          ctx = c;
        },
      }),
      broker,
    );
    const session = new SandboxSession(
      host,
      createHostRequestHandler({
        aiFactory: () => ai,
        capabilities,
        pluginId: "p",
      }),
    );
    await session.activate("p", { commands: [] });
    if (!ctx) throw new Error("activate did not run");
    return { ctx, session };
  }

  const fakeAi = (): AIAPI => ({
    complete: async (prompt) => `completed:${prompt}`,
    listModels: async () => [{ id: "m", name: "M" }],
    stream: async (prompt, _opts, onToken) => {
      onToken(`${prompt}-1`);
      onToken(`${prompt}-2`);
    },
  });

  it("completes across the real transport", async () => {
    const { ctx } = await pair(["ai"], fakeAi());
    await expect(ctx.ai.complete("hello")).resolves.toBe("completed:hello");
  });

  it("streams tokens across the real transport, then resolves", async () => {
    const { ctx } = await pair(["ai"], fakeAi());
    const tokens: string[] = [];
    await ctx.ai.stream("hi", {}, (t) => tokens.push(t));
    expect(tokens).toEqual(["hi-1", "hi-2"]);
  });

  it("lists models across the real transport", async () => {
    const { ctx } = await pair(["ai"], fakeAi());
    await expect(ctx.ai.listModels()).resolves.toEqual([
      { id: "m", name: "M" },
    ]);
  });

  it("surfaces the capability denial to plugin code", async () => {
    // The whole point of the tier: without the grant the plugin gets an error, and
    // the error travels the same path a result would.
    const { ctx } = await pair(["storage"], fakeAi());
    await expect(ctx.ai.complete("hello")).rejects.toThrow(/"ai" capability/);
  });

  it("rejects outstanding requests when the session is disposed", async () => {
    // The dispose ordering (code review MEDIUM-1) matters only because the client is
    // listening when the answer arrives — which is what this pairing proves.
    const stalled: AIAPI = {
      ...fakeAi(),
      complete: () => new Promise(() => {}),
    };
    const { ctx, session } = await pair(["ai"], stalled);
    const promise = ctx.ai.complete("hello");
    await Promise.resolve();
    session.dispose();
    await expect(promise).rejects.toThrow(/disposed/);
  });
});
