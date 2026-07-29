import type { AIModel } from "../../types";
import type { SandboxContext } from "../../types";
import type { PluginOp } from "../plugin-op";
import type { HostToSandbox, SandboxToHost } from "../protocol";

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

  // §260 Phase 4c — `listModels` is STAGED, so the fake Rust here has to own a slot:
  // one payload, consumed on read, exactly like `plugin/staging.rs`.
  let slot: null | string = null;
  const stage = (payload: string) => {
    slot = payload;
  };
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

  /** Enough microtask turns for the client's staged-read chain to send its request. */
  const flush = async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  };

  /** Boots a client whose `activate` hands the context back to the test. */
  function boot() {
    slot = null;
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
    // §260 Phase 4c — the answer arrives as TOKEN frames and the client accumulates it;
    // the response itself carries no text (see `host-ai-bridge`). Tokens for a different
    // id must not join this buffer, and a response for a different id must not settle it.
    reply({ type: "hostStreamToken", requestId: sent.requestId, token: "ans" });
    reply({ type: "hostStreamToken", requestId: "not-mine", token: "WRONG" });
    reply({ type: "hostStreamToken", requestId: sent.requestId, token: "wer" });
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
      value: undefined,
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

  it("pulls the model list from the staged slot, not from the response", async () => {
    const { getCtx, ready, reply, requests } = boot();
    await ready;
    const promise = getCtx().ai.listModels();
    await flush();
    const models: AIModel[] = [{ id: "m", name: "M" }];
    // What the HOST does before it answers: park the payload, then resolve with nothing.
    stage(JSON.stringify(models));
    reply({
      type: "hostResponse",
      requestId: (requests[0] as { requestId: string }).requestId,
      ok: true,
      value: undefined,
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
