import type { AIAPI } from "../../types";

import { describe, expect, it, vi } from "vitest";

import { createAIAPI } from "../../extension-context";
import { createAIRequestHandler, DEFAULT_AI_FACTORY } from "../host-ai-bridge";

// §260 Phase 3c-2c — the host applies the policy for `ai`, so this is where the
// capability check has to be enforcing. It IS enforcing because a `plugin-*` window
// holds no `llm_*` ACL grant (see capabilities/plugin-sandbox.json): the host is the
// only route from a sandbox to a model.
describe("createAIRequestHandler (§260 3c-2c)", () => {
  /** A stand-in for the real `createAIAPI`, so a denial is provable by absence. */
  function fakeAi(): { ai: AIAPI; calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      ai: {
        complete: async (prompt) => {
          calls.push(`complete:${prompt}`);
          return "answer";
        },
        listModels: async () => {
          calls.push("listModels");
          return [{ id: "m", name: "M" }];
        },
        stream: async (prompt, _opts, onToken) => {
          calls.push(`stream:${prompt}`);
          onToken("a");
          onToken("b");
        },
      },
    };
  }

  const noop = () => {};

  it("refuses every ai request when the capability was not granted", async () => {
    const { ai, calls } = fakeAi();
    const handler = createAIRequestHandler({
      aiFactory: () => ai,
      capabilities: ["storage"],
      pluginId: "p",
    });

    for (const request of [
      { kind: "ai_complete", prompt: "x" },
      { kind: "ai_list_models" },
      { kind: "ai_stream", prompt: "x" },
    ] as const) {
      await expect(handler(request, noop)).rejects.toThrow(/"ai" capability/);
    }
    // The gate, not the stand-in, is what refused: the LLM was never reached.
    expect(calls).toEqual([]);
  });

  it("completes through the host's AI policy when granted", async () => {
    const { ai, calls } = fakeAi();
    const handler = createAIRequestHandler({
      aiFactory: () => ai,
      capabilities: ["ai"],
      pluginId: "p",
    });
    await expect(
      handler({ kind: "ai_complete", prompt: "hi" }, noop),
    ).resolves.toBe("answer");
    expect(calls).toEqual(["complete:hi"]);
  });

  it("lists models", async () => {
    const { ai } = fakeAi();
    const handler = createAIRequestHandler({
      aiFactory: () => ai,
      capabilities: ["ai"],
      pluginId: "p",
    });
    await expect(handler({ kind: "ai_list_models" }, noop)).resolves.toEqual([
      { id: "m", name: "M" },
    ]);
  });

  it("forwards stream tokens through onToken and resolves", async () => {
    const { ai } = fakeAi();
    const handler = createAIRequestHandler({
      aiFactory: () => ai,
      capabilities: ["ai"],
      pluginId: "p",
    });
    const tokens: string[] = [];
    await handler({ kind: "ai_stream", prompt: "hi" }, (t) => tokens.push(t));
    expect(tokens).toEqual(["a", "b"]);
  });

  it("surfaces a provider failure as a rejection", async () => {
    // e.g. privacy mode is active and the configured provider is not local — the
    // refusal comes from the shared AI policy, and the plugin must see it.
    const ai: AIAPI = {
      complete: () => Promise.reject(new Error("Privacy mode is active")),
      listModels: () => Promise.reject(new Error("nope")),
      stream: () => Promise.reject(new Error("nope")),
    };
    const handler = createAIRequestHandler({
      aiFactory: () => ai,
      capabilities: ["ai"],
      pluginId: "p",
    });
    await expect(
      handler({ kind: "ai_complete", prompt: "hi" }, noop),
    ).rejects.toThrow(/Privacy mode/);
  });

  it("rejects an unknown ai kind instead of resolving undefined", async () => {
    // A newer sandbox bundle against an older host: better a clear error than a
    // silent `undefined` the plugin mistakes for a result. (Routing between services
    // is the router's job — see host-request-router.test.ts; this is the ai-local
    // fallthrough.)
    const { ai } = fakeAi();
    const handler = createAIRequestHandler({
      aiFactory: () => ai,
      capabilities: ["ai"],
      pluginId: "p",
    });
    await expect(handler({ kind: "ai_dream" } as never, noop)).rejects.toThrow(
      /unsupported/i,
    );
  });

  it("builds the AI surface once, lazily, and never for a plugin without the grant", async () => {
    // Lazily: constructing it eagerly wires a privileged object into a plugin that
    // may never be allowed to use it. Once: `createAIAPI` is cheap but the handler
    // must not re-derive policy per call.
    const { ai } = fakeAi();
    const factory = vi.fn(() => ai);

    createAIRequestHandler({
      aiFactory: factory,
      capabilities: ["storage"],
      pluginId: "p",
    });
    expect(factory).not.toHaveBeenCalled();

    const granted = createAIRequestHandler({
      aiFactory: factory,
      capabilities: ["ai"],
      pluginId: "p",
    });
    expect(factory).not.toHaveBeenCalled(); // still not, before any request
    await granted({ kind: "ai_complete", prompt: "a" }, noop);
    await granted({ kind: "ai_complete", prompt: "b" }, noop);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith("p");
  });

  it("defaults to the trusted tier's own createAIAPI", () => {
    // §260 3c-2c code review — the previous version of this test only asserted that
    // construction did not throw, which (because the surface is built lazily) passed
    // for ANY default, including one that throws when called. The property that
    // matters is identity: the sandboxed tier must run the SAME policy object factory
    // as the trusted tier, or privacy mode and model selection can drift between them.
    expect(DEFAULT_AI_FACTORY).toBe(createAIAPI);
  });
});
