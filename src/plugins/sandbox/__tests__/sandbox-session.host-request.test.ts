import type { SandboxToHost } from "../protocol";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOST_REQUEST_TIMEOUT_MS,
  INFLIGHT_BUDGET,
  MAX_FRAME_TEXT_CHARS,
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

  // §260 Phase 4c security review — every frame is a JSON OBJECT, so length alone decides
  // whether tauri parks it in the app-global channel-data queue that FETCH_CHANNEL_DATA_COMMAND
  // exposes to every webview. These two are the only frames carrying variable-length text.
  describe("no frame carries unbounded text (§260 Phase 4c)", () => {
    it("truncates a provider error instead of putting it on the wire whole", async () => {
      // MEDIUM-2: an `ai` rejection carries the PROVIDER's message, and `llm/claude.rs`
      // builds it as `HTTP {status}: {body}` from the entire response body — a gateway's
      // HTML error page clears 8 KiB easily, and a plugin can provoke one.
      const huge = "E".repeat(MAX_FRAME_TEXT_CHARS * 3);
      const { ask, seen } = harness(() => Promise.reject(new Error(huge)));

      ask("r1");
      await flush();

      const answer = seen.find(
        (m) => (m as { type?: string }).type === "hostResponse",
      ) as { error: string };
      expect(answer.error.length).toBeLessThan(MAX_FRAME_TEXT_CHARS + 100);
      expect(answer.error).toContain("truncated");
      expect(JSON.stringify(answer).length).toBeLessThan(8192);
    });

    it("splits an oversized stream token across frames", async () => {
      // LOW-4: a provider's chunking is not ours to assume — Gemini emits one `part.text`
      // per part, far coarser than an SSE delta.
      const huge = "T".repeat(MAX_FRAME_TEXT_CHARS * 2 + 5);
      const { ask, seen } = harness((_req, onToken) => {
        onToken(huge);
        return Promise.resolve(undefined);
      });

      ask("r1");
      await flush();

      const tokens = seen.filter(
        (m) => (m as { type?: string }).type === "hostStreamToken",
      ) as { token: string }[];
      expect(tokens).toHaveLength(3);
      // Split, not truncated: the plugin still receives every character.
      expect(tokens.map((t) => t.token).join("")).toBe(huge);
      for (const frame of tokens) {
        expect(JSON.stringify(frame).length).toBeLessThan(8192);
      }
    });
  });

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
    for (let i = 0; i < INFLIGHT_BUDGET.ai; i++) ask(`r${i}`);
    await flush();
    expect(handler).toHaveBeenCalledTimes(INFLIGHT_BUDGET.ai);

    ask("over");
    await flush();
    expect(handler).toHaveBeenCalledTimes(INFLIGHT_BUDGET.ai);
    const refusal = seen.find(
      (m) => (m as { requestId?: string }).requestId === "over",
    );
    expect(refusal).toMatchObject({ ok: false, type: "hostResponse" });
    expect((refusal as { error: string }).error).toContain("too many");
  });

  it("does not let one service's backlog starve another", async () => {
    // §260 Phase 4b — the budget used to be ONE pool of 4. An `ai` slot is held until the
    // handler settles and a stream may legitimately run for two minutes, so four
    // completions locked out every other service: the 4a review noted a plugin could not
    // show the toast reporting its own AI failure, and once `editor` joined, it could not
    // read the document either. The bound exists for what `ai` COSTS, which is not a
    // property `ui` or `editor` share.
    const handler = vi.fn(async () => new Promise(() => {})); // nothing ever settles
    const { ask, seen } = harness(handler);

    for (let i = 0; i < INFLIGHT_BUDGET.ai; i++) ask(`ai${i}`, "ai_complete");
    await flush();
    ask("ai-over", "ai_complete");
    await flush();
    expect(
      (
        seen.find(
          (m) => (m as { requestId?: string }).requestId === "ai-over",
        ) as { error: string }
      ).error,
    ).toContain('"ai"');

    // …while the other services are untouched.
    ask("show", "ui_notify");
    ask("read", "editor_get_markdown");
    await flush();
    expect(handler).toHaveBeenCalledTimes(INFLIGHT_BUDGET.ai + 2);
    for (const id of ["show", "read"]) {
      expect(
        seen.find((m) => (m as { requestId?: string }).requestId === id),
      ).toBeUndefined(); // no refusal frame — they were admitted
    }
  });

  it("fails closed on a request whose service it does not recognise", async () => {
    // `budget[unknown]` is `undefined` and `size >= undefined` is false, so an
    // unrecognised prefix would have been UNBOUNDED rather than merely unbudgeted.
    const handler = vi.fn(async () => "ok");
    const { ask, seen } = harness(handler);
    ask("weird", "telemetry_send");
    await flush();
    expect(handler).not.toHaveBeenCalled();
    expect(
      (
        seen.find(
          (m) => (m as { requestId?: string }).requestId === "weird",
        ) as { error: string }
      ).error,
    ).toContain("unknown host service");
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

  it("times out a handler that never settles but KEEPS holding its slot", async () => {
    // §260 3c-2c security review (F4): nothing cancels the provider stream, so
    // freeing the slot at timeout let a plugin fire 4, wait out the timeout, fire 4
    // more — unbounded concurrent LLM streams, defeating the bound's purpose. The
    // sandbox is still ANSWERED at the timeout; it just cannot start more work.
    vi.useFakeTimers();
    let settle: (v: unknown) => void = () => {};
    const handler = vi.fn(
      async () =>
        new Promise((res) => {
          settle = res;
        }),
    );
    const { ask, seen } = harness(handler);
    for (let i = 0; i < INFLIGHT_BUDGET.ai; i++) ask(`r${i}`);
    await vi.advanceTimersByTimeAsync(1);
    vi.advanceTimersByTime(HOST_REQUEST_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(1);

    expect(seen).toContainEqual({
      type: "hostResponse",
      requestId: "r0",
      ok: false,
      error: expect.stringContaining("produced nothing") as unknown as string,
    });

    ask("after-timeout");
    await vi.advanceTimersByTimeAsync(1);
    expect(handler).toHaveBeenCalledTimes(INFLIGHT_BUDGET.ai);
    const refusal = seen.find(
      (m) => (m as { requestId?: string }).requestId === "after-timeout",
    );
    expect((refusal as { error: string }).error).toContain("too many");

    // Settling — not answering — is what frees the slots.
    settle("done");
    await vi.advanceTimersByTimeAsync(1);
    ask("after-settle");
    await vi.advanceTimersByTimeAsync(1);
    expect(handler).toHaveBeenCalledTimes(INFLIGHT_BUDGET.ai + 1);
  });

  it("refuses a replayed id while its old handler is still alive", async () => {
    // §260 3c-2c security review (F5): duplicates used to be refused only WHILE
    // unanswered, so after a timeout the same id could be re-sent and the abandoned
    // handler would stream stale tokens into the new callback and answer the new
    // request with the old result.
    vi.useFakeTimers();
    let settle: (v: unknown) => void = () => {};
    let leak: (t: string) => void = () => {};
    const { ask, seen } = harness(async (_req, onToken) => {
      leak = onToken;
      return new Promise((res) => {
        settle = res;
      });
    });
    ask("r1");
    await vi.advanceTimersByTimeAsync(1);
    vi.advanceTimersByTime(HOST_REQUEST_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(1);

    const before = seen.length;
    ask("r1"); // the sandbox reuses the id it believes is finished
    await vi.advanceTimersByTimeAsync(1);
    const refusal = seen[before] as { error: string };
    expect(refusal.error).toContain("already in flight");

    // And the abandoned handler can neither stream nor answer into anything.
    leak("stale");
    settle("stale-result");
    await vi.advanceTimersByTimeAsync(1);
    expect(
      seen.filter((m) => (m as { type: string }).type === "hostStreamToken"),
    ).toEqual([]);
    expect(
      seen.filter(
        (m) =>
          (m as { requestId?: string; type: string }).type === "hostResponse" &&
          (m as { requestId: string }).requestId === "r1",
      ),
    ).toHaveLength(2); // the timeout answer + the replay refusal, nothing else
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

  it("answers in-flight requests on dispose BEFORE deactivate", async () => {
    // §260 3c-2c code review (MEDIUM-1): the real client closes its transport the
    // moment it sees `deactivate`, so answering after it would drop exactly the
    // frames the loop exists to send — and a harness that ignores `deactivate` (as
    // this one deliberately does not, below) cannot tell the difference.
    const { ask, seen, session } = harness(async () => new Promise(() => {}));
    ask("r1");
    await flush();
    session.dispose();
    await flush();

    const kinds = seen.map((m) => (m as { type: string }).type);
    expect(kinds).toContain("hostResponse");
    expect(kinds).toContain("deactivate");
    expect(kinds.indexOf("hostResponse")).toBeLessThan(
      kinds.indexOf("deactivate"),
    );
    expect(seen).toContainEqual({
      type: "hostResponse",
      requestId: "r1",
      ok: false,
      error: expect.stringContaining("disposed") as unknown as string,
    });
  });

  it("restarts the stall timer on every streamed token", async () => {
    // §260 3c-2c code review (MEDIUM-4): the bound is a stall detector, not a
    // wall-clock ceiling — a completion that is visibly streaming must not be cut off.
    vi.useFakeTimers();
    let emit: (t: string) => void = () => {};
    const { ask, seen } = harness(
      async (_req, onToken) =>
        new Promise(() => {
          emit = onToken;
        }),
    );
    ask("r1");
    await vi.advanceTimersByTimeAsync(1);

    // Stream a token every 80% of the bound, well past the un-refreshed deadline.
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(HOST_REQUEST_TIMEOUT_MS * 0.8);
      emit(`t${i}`);
    }
    await vi.advanceTimersByTimeAsync(1); // let the last token's frame land
    expect(
      seen.filter((m) => (m as { type: string }).type === "hostResponse"),
    ).toEqual([]);
    expect(
      seen.filter((m) => (m as { type: string }).type === "hostStreamToken"),
    ).toHaveLength(5);

    // …and going quiet still ends it.
    await vi.advanceTimersByTimeAsync(HOST_REQUEST_TIMEOUT_MS + 1);
    expect(seen).toContainEqual({
      type: "hostResponse",
      requestId: "r1",
      ok: false,
      error: expect.stringContaining("produced nothing") as unknown as string,
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
