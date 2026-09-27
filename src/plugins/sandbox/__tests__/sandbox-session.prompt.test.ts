// §385 spec 0061 §6 — a prompt holds the command timers of its session and keeps its own stall
// timer (no exemption: the stall timer is the only defence against a lost frame).
import type {
  HostToSandbox,
  SandboxHostRequest,
  SandboxToHost,
} from "../protocol";
import type { SandboxTransport } from "../transport";

import { afterEach, describe, expect, it, vi } from "vitest";

import { HOST_REQUEST_TIMEOUT_MS, SandboxSession } from "../sandbox-session";

const PICK: SandboxHostRequest = {
  items: [{ id: "a", label: "A" }],
  kind: "prompt_quick_pick",
};

function open() {
  vi.useFakeTimers();
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

  it("allows one prompt at a time per plugin", async () => {
    const { ask, sent } = open();
    ask("h1");
    ask("h2");
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toContainEqual(
      expect.objectContaining({
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
});
