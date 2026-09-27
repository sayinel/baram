// §385 spec 0061 §6, §9 — pre-check before sending, and no exemption from the 150 s timer.
import type { SandboxContext } from "../../types";
import type { PluginOp } from "../plugin-op";
import type { HostToSandbox, SandboxToHost } from "../protocol";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HOST_REQUEST_CLIENT_TIMEOUT_MS,
  startSandboxClient,
} from "../sandbox-client";
import { createChannelPair } from "./channel-pair";

const broker = async (op: PluginOp) =>
  op.kind === "source_read" ? "// bundle" : undefined;

function boot() {
  const { host, sandbox } = createChannelPair();
  const requests: Extract<SandboxToHost, { type: "hostRequest" }>[] = [];
  let ctx: SandboxContext | undefined;
  host.onMessage((m) => {
    if (m.type === "hostRequest") requests.push(m);
  });
  const ready = new Promise<void>((resolve) =>
    host.onMessage((m) => {
      if (m.type === "ready") resolve();
    }),
  );
  startSandboxClient(
    sandbox,
    async () => ({ activate: (c: SandboxContext) => void (ctx = c) }),
    broker,
  );
  host.send({ pluginId: "p", type: "activate" });
  return {
    ctx: () => ctx!,
    ready,
    reply: (m: HostToSandbox) => host.send(m),
    requests,
  };
}

const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

describe("ctx.prompts in the sandbox", () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    ["a lone surrogate", [{ id: "a", label: "x\uD83D" }], /lone surrogate/],
    [
      "over 8 MiB as sent",
      Array.from({ length: 400 }, (_, i) => ({
        description: "가".repeat(4096),
        id: String(i),
        label: "가".repeat(4096),
      })),
      /bytes as sent/,
    ],
    [
      "a duplicate id",
      [
        { id: "a", label: "A" },
        { id: "a", label: "B" },
      ],
      /appears twice/,
    ],
  ])("refuses %s without sending a frame", async (_name, items, reason) => {
    const { ctx, ready, requests } = boot();
    await ready;
    await expect(ctx().prompts.showQuickPick(items)).rejects.toThrow(reason);
    await flush();
    expect(requests).toEqual([]);
  });

  it("sends a valid request and maps null to undefined", async () => {
    const { ctx, ready, reply, requests } = boot();
    await ready;
    const answer = ctx().prompts.showInputBox({ title: "T" });
    await flush();
    expect(requests[0].request).toEqual({
      kind: "prompt_input_box",
      opts: { title: "T" },
    });
    reply({
      ok: true,
      requestId: requests[0].requestId,
      type: "hostResponse",
      value: null,
    });
    await expect(answer).resolves.toBeUndefined();
  });

  it("is not exempt from the 150 s timer, and a heartbeat keeps it alive", async () => {
    vi.useFakeTimers();
    const { ctx, ready, reply, requests } = boot();
    await vi.advanceTimersByTimeAsync(1);
    await ready;
    const lost = ctx().prompts.showInputBox();
    const lostOutcome = expect(lost).rejects.toThrow(/produced nothing/);
    await vi.advanceTimersByTimeAsync(HOST_REQUEST_CLIENT_TIMEOUT_MS + 1);
    await lostOutcome;

    const alive = ctx().prompts.showInputBox();
    await vi.advanceTimersByTimeAsync(1);
    const { requestId } = requests[1];
    await vi.advanceTimersByTimeAsync(100_000);
    reply({ requestId, token: "", type: "hostStreamToken" });
    await vi.advanceTimersByTimeAsync(100_000); // 200 s since sending, 100 s since the heartbeat
    reply({ ok: true, requestId, type: "hostResponse", value: "late" });
    await expect(alive).resolves.toBe("late");
  });
});
