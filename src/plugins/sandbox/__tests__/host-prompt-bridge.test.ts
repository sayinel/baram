// §385 spec 0061 §6, §9 — the heartbeat, and answers that survive Rust's serde on the way back.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPromptRequestHandler,
  PROMPT_HEARTBEAT_MS,
} from "../host-prompt-bridge";

function bridge(answer: () => Promise<string | undefined>) {
  return createPromptRequestHandler({
    pluginId: "p",
    prompts: { showInputBox: answer, showQuickPick: answer },
  });
}

describe("createPromptRequestHandler", () => {
  afterEach(() => vi.useRealTimers());

  it("sends an empty token every 60 s while open, and none after", async () => {
    vi.useFakeTimers();
    let resolve: (v: string) => void = () => {};
    const onToken = vi.fn();
    const done = bridge(() => new Promise((r) => (resolve = r)))(
      { kind: "prompt_input_box" },
      onToken,
    );
    await vi.advanceTimersByTimeAsync(PROMPT_HEARTBEAT_MS * 2);
    expect(onToken.mock.calls).toEqual([[""], [""]]);
    resolve("x");
    await done;
    await vi.advanceTimersByTimeAsync(PROMPT_HEARTBEAT_MS * 2);
    expect(onToken).toHaveBeenCalledTimes(2);
  });

  it("answers a cancel with null and an input with no lone surrogate", async () => {
    await expect(
      bridge(async () => undefined)({ kind: "prompt_input_box" }, () => {}),
    ).resolves.toBeNull();
    await expect(
      bridge(async () => "a\uD83Db")({ kind: "prompt_input_box" }, () => {}),
    ).resolves.toBe("a\ufffdb");
  });

  it("refuses to send an input answer over 1,000 characters", async () => {
    await expect(
      bridge(async () => "x".repeat(1001))(
        { kind: "prompt_input_box" },
        () => {},
      ),
    ).rejects.toThrow(/exceeds 1000/);
  });

  it("passes an answer sitting exactly on the 1,000-character limit through unchanged", async () => {
    // The boundary twin of the test above — `>` must stay `>`. `>=` would refuse this exact one.
    const value = "x".repeat(1000);
    await expect(
      bridge(async () => value)({ kind: "prompt_input_box" }, () => {}),
    ).resolves.toBe(value);
  });
});
