import type { AIAPI } from "../../types";
import type { SandboxContext } from "../../types";
import type { PluginOp } from "../plugin-op";
import type { HostToSandbox } from "../protocol";

import { describe, expect, it } from "vitest";

import { createHostRequestHandler } from "../host-request-router";
import { startSandboxClient } from "../sandbox-client";
import { SandboxSession } from "../sandbox-session";
import { createChannelPair } from "./channel-pair";

// §260 3c-2c code review — every other suite tests ONE half against a hand-rolled
// peer, so a field mismatch between the two real halves (a renamed `hostStreamToken`,
// a `requestId` that stops being echoed) would pass everywhere and fail only in the
// live smoke. This pairs the real `SandboxSession`, the real `startSandboxClient`, and
// the real `createHostRequestHandler`, with only the LLM itself faked.
describe("ai end-to-end: real client ↔ real session (§260 3c-2c)", () => {
  /** Boots both halves and returns the sandbox-side context. */
  async function pair(capabilities: ("ai" | "storage")[], ai: AIAPI) {
    // §260 Phase 4c — a staged slot, because `listModels` now pulls (a model list is a
    // JSON array, so it enters tauri's shared queue once it is large).
    let slot: null | string = null;
    const broker = async (op: PluginOp) => {
      if (op.kind === "source_read") return "// bundle";
      if (op.kind === "staged_read") {
        if (slot === null) throw new Error("nothing is staged for this plugin");
        const payload = slot;
        slot = null;
        return payload;
      }
      return undefined;
    };
    const { host, sandbox } = createChannelPair();
    const framesToSandbox: HostToSandbox[] = [];
    // Drops token frames past a threshold, standing in for a failed `plugin_sandbox_send`
    // (the transport logs and never rejects, so the host cannot tell).
    let tokenBudget = Infinity;
    const recordingHost = {
      ...host,
      send: (m: HostToSandbox) => {
        framesToSandbox.push(m);
        if (m.type === "hostStreamToken") {
          if (tokenBudget <= 0) return;
          tokenBudget -= 1;
        }
        host.send(m);
      },
    };
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
      recordingHost,
      createHostRequestHandler({
        aiFactory: () => ai,
        capabilities,
        declaredSettings: [],
        declaredStatusBarIds: [],
        pluginId: "p",
        stage: async (_pluginId, payload) => {
          slot = payload;
        },
      }),
    );
    await session.activate("p", { commands: [] });
    if (!ctx) throw new Error("activate did not run");
    return {
      ctx,
      dropTokensAfter: (n: number) => {
        tokenBudget = n;
      },
      framesToSandbox,
      session,
    };
  }

  const fakeAi = (): AIAPI => ({
    // Never reached through the sandbox: `complete` takes the STREAM path (§260 Phase 4c).
    // Left distinguishable so a regression to the inline answer is visible rather than
    // merely different.
    complete: async (prompt) => `INLINE:${prompt}`,
    listModels: async () => [{ id: "m", name: "M" }],
    stream: async (prompt, _opts, onToken) => {
      onToken(`${prompt}-1`);
      onToken(`${prompt}-2`);
    },
  });

  it("completes across the real transport, with no completion in any frame", async () => {
    // §260 Phase 4c — `complete` is assembled from token frames. The answer is the same
    // string a plugin always got; what changed is that it never rides one frame, because
    // a frame at or above 8 KiB enters tauri's app-global channel-data queue.
    const { ctx, framesToSandbox } = await pair(["ai"], fakeAi());

    await expect(ctx.ai.complete("hello")).resolves.toBe("hello-1hello-2");

    const wire = JSON.stringify(framesToSandbox);
    expect(wire).not.toContain("INLINE:");
    // Each token rides its own frame; none of them is the whole answer.
    expect(wire).not.toContain("hello-1hello-2");
  });

  it("refuses a completion that arrived incomplete", async () => {
    // §260 Phase 4c security review (LOW-2) — token frames are fire-and-forget, so a
    // dropped one used to resolve `complete()` with a truncated string indistinguishable
    // from the whole answer. The host now reports how much it sent.
    const lossy: AIAPI = {
      ...fakeAi(),
      stream: async (prompt, _opts, onToken) => {
        onToken(`${prompt}-1`);
        // The second token never reaches the client — the host counted it, the wire lost it.
        onToken(`${prompt}-2`);
      },
    };
    const { ctx, dropTokensAfter } = await pair(["ai"], lossy);
    dropTokensAfter(1);

    await expect(ctx.ai.complete("hello")).rejects.toThrow(/incomplete/);
  });

  it("streams tokens across the real transport, then resolves", async () => {
    const { ctx } = await pair(["ai"], fakeAi());
    const tokens: string[] = [];
    await ctx.ai.stream("hi", {}, (t) => tokens.push(t));
    expect(tokens).toEqual(["hi-1", "hi-2"]);
  });

  it("lists models across the real transport, through the staged pull", async () => {
    const { ctx, framesToSandbox } = await pair(["ai"], fakeAi());

    await expect(ctx.ai.listModels()).resolves.toEqual([
      { id: "m", name: "M" },
    ]);

    // The array itself never rides a frame — it meets the queue's `[` condition.
    expect(JSON.stringify(framesToSandbox)).not.toContain('"id":"m"');
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
      // The STREAM path, since that is what `complete` takes now.
      stream: () => new Promise(() => {}),
    };
    const { ctx, session } = await pair(["ai"], stalled);
    const promise = ctx.ai.complete("hello");
    await Promise.resolve();
    session.dispose();
    await expect(promise).rejects.toThrow(/disposed/);
  });
});
