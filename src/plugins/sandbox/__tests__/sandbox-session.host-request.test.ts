import type { SandboxToHost } from "../protocol";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOST_REQUEST_TIMEOUT_MS,
  MAX_INFLIGHT_HOST_REQUESTS,
  SandboxSession,
} from "../sandbox-session";
import { createChannelPair } from "./channel-pair";

// §260 Phase 3c-2c — the session ROUTES host requests; it holds no policy. What
// matters here is the bookkeeping: correlation, ordering, bounds, and that a slot
// can never be leaked (a leaked slot is a plugin permanently unable to use `ai`).
describe("SandboxSession host requests (§260 3c-2c)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  /** Collects host→sandbox frames as the sandbox side would see them. */
  function harness(
    handler?: (
      request: unknown,
      onToken: (t: string) => void,
    ) => Promise<unknown>,
  ) {
    const { host, sandbox } = createChannelPair();
    const seen: unknown[] = [];
    sandbox.onMessage((m) => seen.push(m));
    const session = new SandboxSession(
      host,
      handler as ConstructorParameters<typeof SandboxSession>[1],
    );
    const ask = (requestId: string, kind = "ai_complete") =>
      sandbox.send({
        type: "hostRequest",
        requestId,
        request: { kind, prompt: "p" },
      } as SandboxToHost);
    return { ask, seen, session };
  }

  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("answers a resolved request with hostResponse ok", async () => {
    const { ask, seen } = harness(async () => "done");
    ask("r1");
    await flush();
    expect(seen).toContainEqual({
      type: "hostResponse",
      requestId: "r1",
      ok: true,
      value: "done",
    });
  });

  it("answers a rejected request with the error message, not a hang", async () => {
    const { ask, seen } = harness(async () => {
      throw new Error("privacy mode is active");
    });
    ask("r1");
    await flush();
    expect(seen).toContainEqual({
      type: "hostResponse",
      requestId: "r1",
      ok: false,
      error: "privacy mode is active",
    });
  });

  it("delivers stream tokens BEFORE the response", async () => {
    const { ask, seen } = harness(async (_req, onToken) => {
      onToken("a");
      onToken("b");
      return undefined;
    });
    ask("r1");
    await flush();
    const kinds = seen.map((m) => (m as { type: string }).type);
    expect(kinds).toEqual([
      "hostStreamToken",
      "hostStreamToken",
      "hostResponse",
    ]);
    expect(seen[0]).toEqual({
      type: "hostStreamToken",
      requestId: "r1",
      token: "a",
    });
  });

  it("refuses a request beyond the in-flight bound WITHOUT calling the handler", async () => {
    // The bound is what stops a plugin from parking unbounded LLM calls (each of
    // which costs the user money) — so it must reject before the handler runs.
    const handler = vi.fn(async () => new Promise(() => {})); // never settles
    const { ask, seen } = harness(handler);
    for (let i = 0; i < MAX_INFLIGHT_HOST_REQUESTS; i++) ask(`r${i}`);
    await flush();
    expect(handler).toHaveBeenCalledTimes(MAX_INFLIGHT_HOST_REQUESTS);

    ask("over");
    await flush();
    expect(handler).toHaveBeenCalledTimes(MAX_INFLIGHT_HOST_REQUESTS);
    const refusal = seen.find(
      (m) => (m as { requestId?: string }).requestId === "over",
    );
    expect(refusal).toMatchObject({ ok: false, type: "hostResponse" });
    expect((refusal as { error: string }).error).toContain("too many");
  });

  it("refuses a replayed requestId rather than confusing its bookkeeping", async () => {
    const handler = vi.fn(async () => new Promise(() => {}));
    const { ask, seen } = harness(handler);
    ask("dup");
    await flush();
    ask("dup");
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(seen).toContainEqual({
      type: "hostResponse",
      requestId: "dup",
      ok: false,
      error: expect.stringContaining("already in flight") as unknown as string,
    });
  });

  it("times out a handler that never settles and RELEASES the slot", async () => {
    vi.useFakeTimers();
    const handler = vi.fn(async () => new Promise(() => {}));
    const { ask, seen } = harness(handler);
    ask("r1");
    await vi.advanceTimersByTimeAsync(1);
    vi.advanceTimersByTime(HOST_REQUEST_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(1);

    expect(seen).toContainEqual({
      type: "hostResponse",
      requestId: "r1",
      ok: false,
      error: expect.stringContaining("timed out") as unknown as string,
    });
    // The slot is free again: a fresh request reaches the handler.
    ask("r2");
    await vi.advanceTimersByTimeAsync(1);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("does not answer twice when a timed-out handler settles late", async () => {
    vi.useFakeTimers();
    let settle: (v: unknown) => void = () => {};
    const { ask, seen } = harness(
      async () =>
        new Promise((res) => {
          settle = res;
        }),
    );
    ask("r1");
    await vi.advanceTimersByTimeAsync(1);
    vi.advanceTimersByTime(HOST_REQUEST_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(1);
    settle("late");
    await vi.advanceTimersByTimeAsync(1);

    const answers = seen.filter(
      (m) => (m as { type: string }).type === "hostResponse",
    );
    expect(answers).toHaveLength(1);
  });

  it("answers in-flight requests on dispose so the sandbox does not hang", async () => {
    const { ask, seen, session } = harness(async () => new Promise(() => {}));
    ask("r1");
    await flush();
    session.dispose();
    await flush();
    expect(seen).toContainEqual({
      type: "hostResponse",
      requestId: "r1",
      ok: false,
      error: expect.stringContaining("disposed") as unknown as string,
    });
  });

  it("refuses host requests when no handler was wired", async () => {
    // A session built without a handler (no `ai` mediation) must say so rather
    // than silently dropping the frame, which would hang the plugin's promise.
    const { ask, seen } = harness(undefined);
    ask("r1");
    await flush();
    expect(seen).toContainEqual({
      type: "hostResponse",
      requestId: "r1",
      ok: false,
      error: expect.stringContaining("not available") as unknown as string,
    });
  });
});
