import type { AIModel } from "../../types";
import type { PluginOp } from "../plugin-op";
import type { HostToSandbox, SandboxToHost } from "../protocol";
import type { SandboxContext } from "../sandbox-client";

import { afterEach, describe, expect, it, vi } from "vitest";

import { HOST_REQUEST_CLIENT_TIMEOUT_MS } from "../sandbox-client";
import { startSandboxClient } from "../sandbox-client";
import { createChannelPair } from "./channel-pair";

// §260 Phase 3c-2c — `ctx.ai` is host-mediated: the sandbox sends a typed request
// and the HOST applies the policy (privacy mode, model choice). What the sandbox
// side owes is correlation by requestId, token delivery, and no leaked pending
// entry when a response never comes.
describe("startSandboxClient ai (§260 3c-2c)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const broker = async (op: PluginOp) =>
    op.kind === "source_read" ? "// bundle" : undefined;

  /** Boots a client whose `activate` hands the context back to the test. */
  function boot() {
    const { host, sandbox } = createChannelPair();
    const requests: SandboxToHost[] = [];
    let ctx: SandboxContext | undefined;
    host.onMessage((m) => {
      if (m.type === "hostRequest") requests.push(m);
    });
    startSandboxClient(
      sandbox,
      async () => ({
        activate: (c: SandboxContext) => {
          ctx = c;
        },
      }),
      broker,
    );
    host.send({ type: "activate", pluginId: "p" });
    const ready = new Promise<void>((resolve) => {
      host.onMessage((m) => {
        if (m.type === "ready") resolve();
      });
    });
    const reply = (msg: HostToSandbox) => host.send(msg);
    return {
      getCtx: () => {
        if (!ctx) throw new Error("activate did not run");
        return ctx;
      },
      ready,
      reply,
      requests,
    };
  }

  it("sends ai_complete and resolves on the matching requestId", async () => {
    const { getCtx, ready, reply, requests } = boot();
    await ready;
    const promise = getCtx().ai.complete("hello", { maxTokens: 10 });
    await Promise.resolve();

    expect(requests).toHaveLength(1);
    const sent = requests[0] as {
      request: unknown;
      requestId: string;
    };
    expect(sent.request).toEqual({
      kind: "ai_complete",
      prompt: "hello",
      opts: { maxTokens: 10 },
    });
    // A response for a DIFFERENT id must not settle this one.
    reply({
      type: "hostResponse",
      requestId: "not-mine",
      ok: true,
      value: "wrong",
    });
    reply({
      type: "hostResponse",
      requestId: sent.requestId,
      ok: true,
      value: "answer",
    });
    await expect(promise).resolves.toBe("answer");
  });

  it("rejects when the host answers ok:false", async () => {
    const { getCtx, ready, reply, requests } = boot();
    await ready;
    const promise = getCtx().ai.complete("hello");
    await Promise.resolve();
    reply({
      type: "hostResponse",
      requestId: (requests[0] as { requestId: string }).requestId,
      ok: false,
      error: 'Plugin requires "ai" capability',
    });
    await expect(promise).rejects.toThrow(/"ai" capability/);
  });

  it("streams tokens to the callback and resolves on the response", async () => {
    const { getCtx, ready, reply, requests } = boot();
    await ready;
    const tokens: string[] = [];
    const promise = getCtx().ai.stream("hi", {}, (t) => tokens.push(t));
    await Promise.resolve();
    const { requestId } = requests[0] as { requestId: string };
    reply({ type: "hostStreamToken", requestId, token: "a" });
    reply({ type: "hostStreamToken", requestId, token: "b" });
    reply({ type: "hostStreamToken", requestId: "other", token: "x" });
    reply({ type: "hostResponse", requestId, ok: true, value: undefined });
    await promise;
    expect(tokens).toEqual(["a", "b"]);
  });

  it("returns the model list from ai_list_models", async () => {
    const { getCtx, ready, reply, requests } = boot();
    await ready;
    const promise = getCtx().ai.listModels();
    await Promise.resolve();
    const models: AIModel[] = [{ id: "m", name: "M" }];
    reply({
      type: "hostResponse",
      requestId: (requests[0] as { requestId: string }).requestId,
      ok: true,
      value: models,
    });
    await expect(promise).resolves.toEqual(models);
  });

  it("rejects — and forgets — a request the host never answers", async () => {
    vi.useFakeTimers();
    const { getCtx, ready, requests } = boot();
    await vi.advanceTimersByTimeAsync(1);
    await ready;
    const promise = getCtx().ai.complete("hello");
    const assertion = expect(promise).rejects.toThrow(/produced nothing/);
    await vi.advanceTimersByTimeAsync(HOST_REQUEST_CLIENT_TIMEOUT_MS + 1);
    await assertion;
    expect(requests).toHaveLength(1);
  });
});
