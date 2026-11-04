// §394 spec 0073 D11 ③ — a `data-action` click is the second entrance of §385 prompt rights (the
// first is `executePluginCommand`). Rights begin before the handler runs and end when its promise
// settles or at the timeout. A render function gets none — unless, because rights are per plugin
// (spec 0061 §5.3), one of the same plugin's commands or actions is running (§7, the pair).
import { afterEach, describe, expect, it, vi } from "vitest";

import { runPluginAction } from "../plugin-action";
import {
  beginPluginInvocation,
  promptRefusal,
  resetPromptGate,
} from "../prompt-gate";

afterEach(() => {
  resetPromptGate();
  vi.useRealTimers();
});

describe("runPluginAction", () => {
  /** What fails this: not calling `beginPluginInvocation`, or ending it before the handler's
   *  promise settles (`end()` outside `finally`, or before the `await`). */
  it("holds prompt rights until the handler's promise settles, then ends them", async () => {
    let release!: () => void;
    const seen: Array<null | string> = [];
    const running = runPluginAction(
      "p",
      () =>
        new Promise<void>((resolve) => {
          seen.push(promptRefusal("p"));
          release = resolve;
        }),
      null,
    );
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toBeNull();
    expect(promptRefusal("p")).toBeNull();
    release();
    await running;
    expect(promptRefusal("p")).toMatch(/commands is running/);
  });

  /** §6 — a throwing handler ends rights and does not reject (no toast; logged). */
  it("ends rights and resolves when the handler throws", async () => {
    await expect(
      runPluginAction(
        "p",
        () => {
          throw new Error("boom");
        },
        null,
      ),
    ).resolves.toBeUndefined();
    expect(promptRefusal("p")).toMatch(/commands is running/);
  });

  /** D11 ③ "길어야 CALL_TIMEOUT_MS" for the trusted tier — rights end at the timeout even if
   *  the handler never settles. The pair of the first row. */
  it("ends rights at the timeout when the handler never settles", async () => {
    vi.useFakeTimers();
    const running = runPluginAction(
      "p",
      () => new Promise<void>(() => {}),
      1_000,
    );
    await vi.advanceTimersByTimeAsync(999);
    expect(promptRefusal("p")).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await running;
    expect(promptRefusal("p")).toMatch(/commands is running/);
  });
});

describe("a render function's prompt (§7 — the two entrances' pair)", () => {
  /** A render runs with no invocation of its own: refused while nothing of the plugin runs… */
  it("is refused when no command or action of the plugin runs", () => {
    expect(promptRefusal("p")).toMatch(/commands is running/);
  });

  /** …and allowed while one does, because rights are the plugin's, not the call's. */
  it("is allowed while an action of the same plugin runs, and while a command does", async () => {
    let release!: () => void;
    const running = runPluginAction(
      "p",
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      null,
    );
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(promptRefusal("p")).toBeNull();
    expect(promptRefusal("other")).toMatch(/commands is running/);
    release();
    await running;
    const end = beginPluginInvocation("p");
    expect(promptRefusal("p")).toBeNull();
    end();
  });
});
