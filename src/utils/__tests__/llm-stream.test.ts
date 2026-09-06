// issue 265 — createLLMStream registers three Tauri event listeners in a row.
// If the second or third `listen()` rejects, the ones already registered must
// not be left behind: a leaked listener fires on every later llm:* event for
// the life of the window. The returned cleanup must also be safe to call more
// than once, since the stream cleans itself up on done/error and every caller
// calls it again in a `finally`.
import { listen } from "@tauri-apps/api/event";
import type { Event } from "@tauri-apps/api/event";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { subscribeToAsyncErrors } from "../async-error-policy";
import { createLLMStream, unlistenQuietly } from "../llm-stream";

const mockListen = vi.mocked(listen);

type Handler = (event: Event<unknown>) => void;

/** A Tauri event envelope around `payload`, as listen() handlers receive it. */
function ev(payload: unknown): Event<unknown> {
  return { event: "llm", id: 0, payload };
}

/** Registers listeners in order; the Nth (1-based) call rejects when asked. */
function arrangeListen(rejectAt?: number) {
  const unlistens: ReturnType<typeof vi.fn>[] = [];
  const handlers = new Map<string, Handler>();
  let call = 0;
  mockListen.mockImplementation(async (event: string, handler: Handler) => {
    call += 1;
    if (call === rejectAt) throw new Error(`listen ${call} failed`);
    handlers.set(event, handler);
    const un = vi.fn();
    unlistens.push(un);
    return un;
  });
  return { handlers, unlistens };
}

beforeEach(() => {
  mockListen.mockReset();
});

describe("createLLMStream listener registration (issue 265)", () => {
  it("unlistens the first listener when the second listen() rejects", async () => {
    const { unlistens } = arrangeListen(2);
    await expect(createLLMStream("r1", { onToken: () => {} })).rejects.toThrow(
      /listener registration failed/,
    );
    expect(unlistens).toHaveLength(1);
    expect(unlistens[0]).toHaveBeenCalledTimes(1);
  });

  it("unlistens the first two when the third listen() rejects", async () => {
    const { unlistens } = arrangeListen(3);
    await expect(createLLMStream("r1", { onToken: () => {} })).rejects.toThrow(
      /listener registration failed/,
    );
    expect(unlistens).toHaveLength(2);
    for (const un of unlistens) expect(un).toHaveBeenCalledTimes(1);
  });

  it("keeps the original failure as the cause", async () => {
    arrangeListen(2);
    const err = await createLLMStream("r1", { onToken: () => {} }).catch(
      (e: unknown) => e,
    );
    expect((err as Error).cause).toBeInstanceOf(Error);
    expect(((err as Error).cause as Error).message).toBe("listen 2 failed");
  });

  it("cleanup is idempotent — each listener is unlistened exactly once", async () => {
    const { unlistens } = arrangeListen();
    const cleanup = await createLLMStream("r1", { onToken: () => {} });
    cleanup();
    cleanup();
    expect(unlistens).toHaveLength(3);
    for (const un of unlistens) expect(un).toHaveBeenCalledTimes(1);
  });

  it("cleans itself up on llm:done, and a later cleanup() call is a no-op", async () => {
    const { handlers, unlistens } = arrangeListen();
    const onToken = vi.fn();
    const onDone = vi.fn();
    const cleanup = await createLLMStream("r1", { onDone, onToken });
    handlers.get("llm:token")!(ev({ requestId: "r1", token: "a" }));
    handlers.get("llm:done")!(ev({ requestId: "r1", totalTokens: 1 }));
    expect(onToken).toHaveBeenCalledWith("a");
    expect(onDone).toHaveBeenCalledTimes(1);
    for (const un of unlistens) expect(un).toHaveBeenCalledTimes(1);
    cleanup();
    for (const un of unlistens) expect(un).toHaveBeenCalledTimes(1);
  });

  it("still delivers events queued for this request after cleanup(), once each", async () => {
    // Tauri's unlisten is async and the command response is not ordered
    // against the events emitted before it: a caller that cleans up in a
    // `finally` right after `llmComplete` resolved must still get the tail of
    // its own stream. Only OTHER requests are filtered.
    const { handlers, unlistens } = arrangeListen();
    const onToken = vi.fn();
    const onDone = vi.fn();
    const cleanup = await createLLMStream("r1", { onDone, onToken });
    cleanup();
    for (const un of unlistens) expect(un).toHaveBeenCalledTimes(1);
    handlers.get("llm:token")!(ev({ requestId: "r1", token: "tail" }));
    handlers.get("llm:done")!(ev({ requestId: "r1", totalTokens: 1 }));
    handlers.get("llm:token")!(ev({ requestId: "r2", token: "other" }));
    expect(onToken).toHaveBeenCalledTimes(1);
    expect(onToken).toHaveBeenCalledWith("tail");
    expect(onDone).toHaveBeenCalledTimes(1);
    // The terminal handler's own cleanup is a no-op the second time.
    for (const un of unlistens) expect(un).toHaveBeenCalledTimes(1);
  });

  it("hands onDone the done payload", async () => {
    const { handlers } = arrangeListen();
    const onDone = vi.fn();
    await createLLMStream("r1", { onDone, onToken: () => {} });
    handlers.get("llm:done")!(ev({ requestId: "r1", totalTokens: 7 }));
    expect(onDone).toHaveBeenCalledWith({ requestId: "r1", totalTokens: 7 });
  });

  it("ignores events for other request ids", async () => {
    const { handlers, unlistens } = arrangeListen();
    const onToken = vi.fn();
    await createLLMStream("r1", { onToken });
    handlers.get("llm:token")!(ev({ requestId: "other", token: "x" }));
    handlers.get("llm:done")!(ev({ requestId: "other" }));
    expect(onToken).not.toHaveBeenCalled();
    for (const un of unlistens) expect(un).not.toHaveBeenCalled();
  });
});

describe("unlistenQuietly — Tauri's unlisten is async at runtime (issue 265)", () => {
  it("reports a rejected unlisten instead of leaving it unhandled", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reports = vi.fn();
    const off = subscribeToAsyncErrors(reports);
    await unlistenQuietly(() =>
      Promise.reject(new Error("__TAURI_EVENT_PLUGIN_INTERNALS__ gone")),
    );
    await unlistenQuietly(() => {
      throw new Error("sync throw");
    });
    await unlistenQuietly(() => {});
    expect(reports).toHaveBeenCalledTimes(2);
    expect(reports.mock.calls.map((c) => c[0].scope)).toEqual([
      "llm-stream unlisten",
      "llm-stream unlisten",
    ]);
    off();
    vi.restoreAllMocks();
  });

  it("cleanup after a rejecting unlisten does not throw and is reported", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reports = vi.fn();
    const off = subscribeToAsyncErrors(reports);
    mockListen.mockImplementation(
      async () => () =>
        Promise.reject(new Error("teardown")) as unknown as void,
    );
    const cleanup = await createLLMStream("r1", { onToken: () => {} });
    expect(() => cleanup()).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(reports).toHaveBeenCalledTimes(3);
    off();
    vi.restoreAllMocks();
  });

  it("registration rollback waits for the unlistens to settle before rethrowing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let settled = 0;
    let call = 0;
    mockListen.mockImplementation(async () => {
      call += 1;
      if (call === 3) throw new Error("listen 3 failed");
      return (() =>
        new Promise<void>((r) =>
          setTimeout(() => {
            settled += 1;
            r();
          }, 5),
        )) as unknown as () => void;
    });
    await expect(createLLMStream("r1", { onToken: () => {} })).rejects.toThrow(
      /registration failed/,
    );
    expect(settled).toBe(2);
    vi.restoreAllMocks();
  });
});

describe("abortable registration (issue 265)", () => {
  it("an abort while the second listen() never settles releases the first at once and rejects", async () => {
    const unlistens: ReturnType<typeof vi.fn>[] = [];
    let call = 0;
    mockListen.mockImplementation(async () => {
      call += 1;
      if (call === 2) await new Promise(() => {}); // the event IPC stalls
      const un = vi.fn();
      unlistens.push(un);
      return un;
    });
    const controller = new AbortController();
    const pending = createLLMStream(
      "r1",
      { onToken: () => {} },
      { signal: controller.signal },
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(unlistens).toHaveLength(1);
    expect(unlistens[0]).not.toHaveBeenCalled();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(unlistens[0]).toHaveBeenCalledTimes(1);
  });

  it("a listen() that settles after the abort is unlistened on arrival", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let release!: () => void;
    const late = vi.fn();
    mockListen.mockImplementation(
      () => new Promise((r) => (release = () => r(late))),
    );
    const controller = new AbortController();
    const pending = createLLMStream(
      "r1",
      { onToken: () => {} },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(late).not.toHaveBeenCalled();
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(late).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it("an already-aborted signal issues no listen() at all", async () => {
    // A registration whose response then stalled would have no handle anyone
    // could release — so it must not be started in the first place.
    arrangeListen();
    const controller = new AbortController();
    controller.abort();
    await expect(
      createLLMStream(
        "r1",
        { onToken: () => {} },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mockListen).not.toHaveBeenCalled();
  });

  it("a rollback whose unlisten never settles still rethrows within the grace period", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let call = 0;
    mockListen.mockImplementation(async () => {
      call += 1;
      if (call === 2) throw new Error("listen 2 failed");
      return (() => new Promise<void>(() => {})) as unknown as () => void;
    });
    const started = Date.now();
    await expect(createLLMStream("r1", { onToken: () => {} })).rejects.toThrow(
      /registration failed/,
    );
    expect(Date.now() - started).toBeLessThan(2000);
    vi.restoreAllMocks();
  });
});
