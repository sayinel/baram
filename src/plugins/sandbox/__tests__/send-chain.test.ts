// §395 spec 0074 D12 · §5.4 · §7 "전송 사슬" — a sandbox's frames leave one after another: the next
// `plugin_sandbox_send` starts only once the previous one settled. A fake `pluginSandboxSend` whose
// promises the test settles by hand; counted, never timed.
import type { HostToSandbox, SandboxToHost } from "../protocol";

import { beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => ({
  frames: [] as unknown[],
  settle: [] as Array<(ok: boolean) => void>,
}));

vi.mock("../../../ipc/plugin-invoke", () => ({
  pluginSandboxSend: vi.fn(
    (_pluginId: string, msg: unknown) =>
      new Promise<void>((resolve, reject) => {
        sent.frames.push(msg);
        sent.settle.push((ok) =>
          ok ? resolve() : reject(new Error("sandbox is not connected")),
        );
      }),
  ),
}));

const listen = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listen(...args),
}));

import { SandboxSession } from "../sandbox-session";
import { createSendChain } from "../send-chain";
import { createHostTransport } from "../tauri-host-transport";

let deliver: (payload: unknown) => void;

/** Let every queued microtask run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

const frame = (requestId: string): HostToSandbox => ({
  ok: true,
  requestId,
  type: "hostResponse",
  value: null,
});

beforeEach(() => {
  sent.frames.length = 0;
  sent.settle.length = 0;
  listen
    .mockReset()
    .mockImplementation(
      async (_event: string, handler: (e: { payload: unknown }) => void) => {
        deliver = (payload) => handler({ payload });
        return vi.fn().mockResolvedValue(undefined);
      },
    );
});

describe("createSendChain", () => {
  /** What fails this: sends started as frames arrive (the second and third would go before the first
   *  settled — the D12 race between two async commands). */
  it("starts the next send only after the previous one settled, in order", async () => {
    const send = createSendChain("alpha");
    send(frame("a"), "send to");
    send(frame("b"), "send to");
    send(frame("c"), "send to");
    expect(sent.frames).toHaveLength(1);
    sent.settle[0]!(true);
    await flush();
    expect(sent.frames).toHaveLength(2);
    sent.settle[1]!(true);
    await flush();
    expect(
      sent.frames.map((f) => (f as { requestId: string }).requestId),
    ).toEqual(["a", "b", "c"]);
  });

  /** P31 — an idle chain sends in the same tick, as `send` did before. */
  it("sends at once when nothing is in flight", () => {
    createSendChain("alpha")(frame("a"), "send to");
    expect(sent.frames).toHaveLength(1);
  });

  /** §5.4 — a rejected send (the sandbox not connected yet, the activate retry window) is logged and
   *  the chain goes on. What fails this: a chain that stops at the first rejection. */
  it("goes on after a rejected send", async () => {
    const send = createSendChain("alpha");
    send(frame("a"), "send to");
    send(frame("b"), "send to");
    sent.settle[0]!(false);
    await flush();
    expect(sent.frames).toHaveLength(2);
  });
});

describe("the host transport's frames share one chain", () => {
  /** §5.4 — the refusal of a malformed request waits behind a send in flight. What fails this:
   *  `refuseIfAwaited` calling `pluginSandboxSend` directly (the refusal would leave first). */
  it("sends a refusal after the frame already in flight", async () => {
    const transport = await createHostTransport("alpha");
    transport.send({ type: "deactivate" });
    deliver({
      msg: {
        request: { kind: "editor_insert_text", text: 42 },
        requestId: "bad",
        type: "hostRequest",
      } as unknown as SandboxToHost,
      pluginId: "alpha",
    });
    expect(sent.frames).toHaveLength(1);
    sent.settle[0]!(true);
    await flush();
    expect(sent.frames[1]).toMatchObject({
      ok: false,
      requestId: "bad",
      type: "hostResponse",
    });
  });

  /** §7 — `dispose` sends the answers it owes, then `deactivate`, and closes the transport in the same
   *  tick; the chain does not read `closed`, so `deactivate` still leaves, after the answer. What fails
   *  this: a chain that checks `closed` (the frames queued before `close` would be dropped). */
  it("still sends deactivate after the remaining answer when dispose closes in the same tick", async () => {
    const transport = await createHostTransport("alpha");
    const session = new SandboxSession(transport, () => new Promise(() => {}));
    deliver({
      msg: {
        request: { kind: "editor_get_text" },
        requestId: "r1",
        type: "hostRequest",
      } as SandboxToHost,
      pluginId: "alpha",
    });
    await flush();
    session.dispose();
    expect(sent.frames).toEqual([
      expect.objectContaining({
        ok: false,
        requestId: "r1",
        type: "hostResponse",
      }),
    ]);
    sent.settle[0]!(true);
    await flush();
    expect(sent.frames[1]).toEqual({ type: "deactivate" });
  });
});
