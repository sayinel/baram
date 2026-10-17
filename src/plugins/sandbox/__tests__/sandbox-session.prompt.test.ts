// §385 spec 0061 §6 — a prompt holds the command timers of its session and keeps its own stall
// timer (no exemption: the stall timer is the only defence against a lost frame).
import type {
  HostToSandbox,
  PromptHostRequest,
  SandboxHostRequest,
  SandboxToHost,
} from "../protocol";
import type { SandboxTransport } from "../transport";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createPromptRequestHandler } from "../host-prompt-bridge";
import {
  CALL_TIMEOUT_MS,
  HOST_REQUEST_TIMEOUT_MS,
  SandboxSession,
  splitForFrame,
} from "../sandbox-session";

const PICK: SandboxHostRequest = {
  items: [{ id: "a", label: "A" }],
  kind: "prompt_quick_pick",
};

/** The transport half only — a session is built on top of it per test, with whichever
 *  handler that test needs. */
function makeTransport() {
  const sent: HostToSandbox[] = [];
  let receive: (m: SandboxToHost) => void = () => {};
  const transport: SandboxTransport<SandboxToHost, HostToSandbox> = {
    close: () => {},
    onMessage: (h) => {
      receive = h;
      return () => {};
    },
    send: (m) => void sent.push(m),
  };
  return { receive: (m: SandboxToHost) => receive(m), sent, transport };
}

function open() {
  vi.useFakeTimers();
  const { receive, sent, transport } = makeTransport();
  let settle:
    undefined | { reject: (e: Error) => void; resolve: (v: unknown) => void };
  const session = new SandboxSession(transport, (request) =>
    request.kind === "prompt_quick_pick"
      ? new Promise((resolve, reject) => {
          settle = { reject, resolve };
        })
      : Promise.resolve(undefined),
  );
  const ask = (requestId: string) =>
    receive({ request: PICK, requestId, type: "hostRequest" });
  return { ask, sent, session, settle: () => settle! };
}

const watch = (p: Promise<unknown>) => {
  const outcome = vi.fn();
  p.then(outcome, outcome);
  return outcome;
};

describe("SandboxSession and prompts", () => {
  afterEach(() => vi.useRealTimers());

  it("holds a command's 30 s timer while a prompt is open, then gives it 30 s afresh", async () => {
    const { ask, session, settle } = open();
    const outcome = watch(session.invokeCommand("pick"));
    ask("h1");
    await vi.advanceTimersByTimeAsync(31_000);
    expect(outcome).not.toHaveBeenCalled();
    settle().resolve("a");
    await vi.advanceTimersByTimeAsync(29_000);
    expect(outcome).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_001);
    expect(outcome).toHaveBeenCalledWith(
      new Error('Sandbox command "pick" timed out'),
    );
  });

  it("gives a call started while a prompt is open no timer until the prompt settles", async () => {
    const { ask, session, settle } = open();
    ask("h1");
    const outcome = watch(session.invokeCommand("later"));
    await vi.advanceTimersByTimeAsync(40_000);
    expect(outcome).not.toHaveBeenCalled();
    settle().reject(new Error("refused"));
    await vi.advanceTimersByTimeAsync(30_001);
    expect(outcome).toHaveBeenCalledWith(
      new Error('Sandbox command "later" timed out'),
    );
  });

  it("allows one prompt at a time per plugin, and h1 keeps running", async () => {
    const { ask, sent } = open();
    ask("h1");
    ask("h2");
    await vi.advanceTimersByTimeAsync(0);
    // The positive twin: h2's refusal must not be h1 losing its slot too.
    expect(sent).not.toContainEqual(
      expect.objectContaining({ requestId: "h1", type: "hostResponse" }),
    );
    expect(sent).toContainEqual(
      expect.objectContaining({
        error: expect.stringMatching(/too many "prompt" requests in flight/),
        ok: false,
        requestId: "h2",
        type: "hostResponse",
      }),
    );
  });

  it("keeps the stall timer on a prompt request — a silent handler fails at 120 s", async () => {
    const { ask, sent } = open();
    ask("h1");
    await vi.advanceTimersByTimeAsync(HOST_REQUEST_TIMEOUT_MS + 1);
    expect(sent).toContainEqual(
      expect.objectContaining({
        ok: false,
        requestId: "h1",
        type: "hostResponse",
      }),
    );
  });

  // spec 0061 §11 — the SANDBOX-SIDE half of the heartbeat row: every test above supplies its
  // own stub handler, so a router that forgot to pass `onToken` to the REAL bridge
  // (`host-prompt-bridge.ts`) would still pass every test in this file. This wires the real
  // `createPromptRequestHandler` straight into a `SandboxSession`.
  it("keeps a real, silent prompt handler's request alive past 120 s via the heartbeat", async () => {
    vi.useFakeTimers();
    const never = () => new Promise<string | undefined>(() => {});
    const prompt = createPromptRequestHandler({
      pluginId: "p",
      prompts: { showInputBox: never, showQuickPick: never },
    });
    const { receive, sent, transport } = makeTransport();
    // `SandboxSession`'s handler type accepts the whole `SandboxHostRequest` union — this test
    // only ever sends a `prompt_quick_pick`, so the narrow is asserted rather than routed.
    const session = new SandboxSession(transport, (request, onToken) =>
      prompt(request as PromptHostRequest, onToken),
    );
    void session; // constructed for its side effect of wiring `transport.onMessage`
    receive({ request: PICK, requestId: "h1", type: "hostRequest" });
    await vi.advanceTimersByTimeAsync(3 * HOST_REQUEST_TIMEOUT_MS);
    expect(sent).not.toContainEqual(
      expect.objectContaining({
        ok: false,
        requestId: "h1",
        type: "hostResponse",
      }),
    );
    expect(sent).toContainEqual({
      requestId: "h1",
      token: "",
      type: "hostStreamToken",
    });
  });

  // A handler that throws SYNCHRONOUSLY (as opposed to returning a rejected promise) never
  // reaches the session's `.then`/`.finally` chain unless the session catches the throw; left
  // uncaught, the slot would stay taken and `callTimersHeld` stuck at `true` forever (a pending
  // command would then NEVER time out).
  it("answers ok:false and resumes command timers when the handler throws synchronously", async () => {
    vi.useFakeTimers();
    const { receive, sent, transport } = makeTransport();
    const session = new SandboxSession(transport, (request) => {
      if (request.kind === "prompt_quick_pick") {
        throw new Error("boom"); // not `Promise.reject` — a genuine sync throw
      }
      return Promise.resolve(undefined);
    });
    const outcome = watch(session.invokeCommand("pick"));
    receive({ request: PICK, requestId: "h1", type: "hostRequest" });
    await vi.advanceTimersByTimeAsync(0); // let the caught rejection's .then/.finally settle
    expect(sent).toContainEqual(
      expect.objectContaining({
        ok: false,
        requestId: "h1",
        type: "hostResponse",
      }),
    );
    await vi.advanceTimersByTimeAsync(30_001);
    expect(outcome).toHaveBeenCalledWith(
      new Error('Sandbox command "pick" timed out'),
    );
  });
});

describe("SandboxSession's answered calls (§394 plan 0125 Task 11)", () => {
  afterEach(() => vi.useRealTimers());

  // The answer path's `pending.delete`. An answered call left in the table has no timer, so
  // nothing shows until a prompt closes: `resumeCallTimers` then arms a fresh 30 s for it — one
  // timer per answered call per prompt, each rejecting a settled promise. What fails this:
  // `settleCall` without the delete — three timers here instead of one. The pair: the call still
  // waiting does get its timer, and it fires.
  it("arms no timer for an answered call when a prompt closes", async () => {
    vi.useFakeTimers();
    const { receive, transport } = makeTransport();
    let settle!: (value: unknown) => void;
    const session = new SandboxSession(transport, (request) =>
      request.kind === "prompt_quick_pick"
        ? new Promise((resolve) => {
            settle = resolve;
          })
        : Promise.resolve(undefined),
    );
    const command = session.invokeCommand("done");
    const action = session.invokeAction({ kind: "panel", panelId: "p" }, "go");
    const waiting = watch(session.invokeCommand("waits"));
    receive({ callId: "call-1", ok: true, type: "callResult", value: 1 });
    receive({ id: "action-2", ok: true, type: "actionResult" });
    await expect(command).resolves.toBe(1);
    await expect(action).resolves.toBeUndefined();
    receive({ request: PICK, requestId: "h1", type: "hostRequest" });
    settle("a");
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS);
    expect(waiting).toHaveBeenCalledWith(
      new Error('Sandbox command "waits" timed out'),
    );
  });
});

describe("splitForFrame", () => {
  it("still answers with one frame for an empty string (the heartbeat's token)", () => {
    expect(splitForFrame("")).toEqual([""]);
  });
});
