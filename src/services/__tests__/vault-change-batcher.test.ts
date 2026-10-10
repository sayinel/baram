// §393 — WHEN the watcher's events become a `sync_index_paths` call, and when the result is
// announced. What would make each case fail is stated on it.
import type { IndexSyncAnswer } from "../../ipc/types";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createVaultChangeBatcher,
  VAULT_SYNC_MAX_WAIT_MS,
  VAULT_SYNC_QUIET_MS,
} from "../vault-change-batcher";

/** An answer naming `contexts`; the batcher passes `linksChanged` through without reading it. */
const answer = (contexts: string[]): IndexSyncAnswer => ({
  contexts,
  linksChanged: false,
});

/** A `sync` whose answer the test releases by hand. */
function heldSync() {
  const calls: Array<{
    paths: unknown;
    release: (answer: IndexSyncAnswer) => void;
  }> = [];
  const sync = vi.fn(
    (paths: unknown) =>
      new Promise<IndexSyncAnswer>((resolve) => {
        calls.push({ paths, release: resolve });
      }),
  );
  return { calls, sync };
}

/** Let resolved promises run their continuations (a few hops: `await`, `finally`, the next `send`). */
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe("createVaultChangeBatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends one batch per path after the quiet window, marking changed-only paths", async () => {
    // Fails if events are sent one by one, before the quiet window, or without the changed-only bit.
    const { calls, sync } = heldSync();
    const batcher = createVaultChangeBatcher({ onSynced: vi.fn(), sync });
    batcher.touch("/v/a.md", "deleted");
    batcher.touch("/v/a.md", "created");
    batcher.touch("/v/b.md", "changed");
    batcher.touch("/v/b.md", "changed");
    await vi.advanceTimersByTimeAsync(VAULT_SYNC_QUIET_MS - 1);
    expect(sync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(calls[0].paths).toEqual([
      { changedOnly: false, path: "/v/a.md" },
      { changedOnly: true, path: "/v/b.md" },
    ]);
  });

  it("sends at the max wait while events keep arriving", async () => {
    // Fails if the quiet timer alone decides — a steady writer would never be synced — or if the
    // max wait runs from anything but the batch's first event: nothing at 1999 ms, the batch at
    // 2000 ms.
    const { sync } = heldSync();
    const batcher = createVaultChangeBatcher({ onSynced: vi.fn(), sync });
    // Each touch lands before the quiet window of the one before closes.
    const step = VAULT_SYNC_QUIET_MS - 100;
    let now = 0;
    for (; now + step < VAULT_SYNC_MAX_WAIT_MS; now += step) {
      batcher.touch("/v/a.md", "changed");
      await vi.advanceTimersByTimeAsync(step);
    }
    batcher.touch("/v/a.md", "changed");
    await vi.advanceTimersByTimeAsync(VAULT_SYNC_MAX_WAIT_MS - 1 - now);
    expect(sync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("announces only after the sync resolved, and only non-empty answers", async () => {
    // Fails if `onSynced` runs before `await sync(...)` — a listener would read a stale index.
    const { calls, sync } = heldSync();
    const onSynced = vi.fn();
    const batcher = createVaultChangeBatcher({ onSynced, sync });
    batcher.touch("/v/a.md", "changed");
    await vi.advanceTimersByTimeAsync(VAULT_SYNC_QUIET_MS);
    expect(onSynced).not.toHaveBeenCalled();
    calls[0].release(answer(["ctx-1"]));
    await settle();
    expect(onSynced).toHaveBeenCalledTimes(1);
    expect(onSynced).toHaveBeenCalledWith(answer(["ctx-1"]));

    batcher.touch("/v/b.md", "changed");
    await vi.advanceTimersByTimeAsync(VAULT_SYNC_QUIET_MS);
    calls[1].release(answer([]));
    await settle();
    expect(onSynced).toHaveBeenCalledTimes(1);
  });

  it("is serial: events during a sync form the next batch, sent once the first settles", async () => {
    // Fails if a timer that fires mid-sync sends a second, overlapping call.
    const { calls, sync } = heldSync();
    const batcher = createVaultChangeBatcher({ onSynced: vi.fn(), sync });
    batcher.touch("/v/a.md", "changed");
    await vi.advanceTimersByTimeAsync(VAULT_SYNC_QUIET_MS);
    batcher.touch("/v/b.md", "created");
    await vi.advanceTimersByTimeAsync(VAULT_SYNC_MAX_WAIT_MS);
    expect(sync).toHaveBeenCalledTimes(1);
    calls[0].release(answer([]));
    await settle();
    expect(sync).toHaveBeenCalledTimes(2);
    expect(calls[1].paths).toEqual([{ changedOnly: false, path: "/v/b.md" }]);
  });

  it("drops a failed batch and keeps working", async () => {
    // Fails if a rejection escapes `send` or the failed batch is re-queued (the second call would carry stale paths).
    const onSynced = vi.fn();
    const sync = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(answer(["ctx-1"]));
    const batcher = createVaultChangeBatcher({ onSynced, sync });
    batcher.touch("/v/a.md", "changed");
    await vi.advanceTimersByTimeAsync(VAULT_SYNC_QUIET_MS);
    await settle();
    expect(onSynced).not.toHaveBeenCalled();
    batcher.touch("/v/a.md", "changed");
    await vi.advanceTimersByTimeAsync(VAULT_SYNC_QUIET_MS);
    await settle();
    expect(onSynced).toHaveBeenCalledWith(answer(["ctx-1"]));
  });

  it("sends nothing after dispose", async () => {
    // Fails if `dispose` leaves the timers armed.
    const { sync } = heldSync();
    const batcher = createVaultChangeBatcher({ onSynced: vi.fn(), sync });
    batcher.touch("/v/a.md", "changed");
    batcher.dispose();
    await vi.advanceTimersByTimeAsync(VAULT_SYNC_MAX_WAIT_MS);
    expect(sync).not.toHaveBeenCalled();
  });

  it("does not announce a sync that resolves after dispose", async () => {
    // Pairs with the announce test above. Fails if `onSynced` ignores `disposed`.
    const { calls, sync } = heldSync();
    const onSynced = vi.fn();
    const batcher = createVaultChangeBatcher({ onSynced, sync });
    batcher.touch("/v/a.md", "changed");
    await vi.advanceTimersByTimeAsync(VAULT_SYNC_QUIET_MS);
    expect(sync).toHaveBeenCalledTimes(1);
    batcher.dispose();
    calls[0].release(answer(["ctx-1"]));
    await settle();
    expect(onSynced).not.toHaveBeenCalled();
  });

  it("still sends the queued batch when onSynced throws", async () => {
    // Fails if `onSynced` runs outside a try/catch: `send` rejects and the follow-up is never sent.
    const { calls, sync } = heldSync();
    const onSynced = vi.fn(() => {
      throw new Error("listener boom");
    });
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const batcher = createVaultChangeBatcher({ onSynced, sync });
      batcher.touch("/v/a.md", "changed");
      await vi.advanceTimersByTimeAsync(VAULT_SYNC_QUIET_MS);
      batcher.touch("/v/b.md", "created");
      await vi.advanceTimersByTimeAsync(VAULT_SYNC_MAX_WAIT_MS);
      expect(sync).toHaveBeenCalledTimes(1);
      calls[0].release(answer(["ctx-1"]));
      await settle();
      expect(onSynced).toHaveBeenCalledTimes(1);
      expect(sync).toHaveBeenCalledTimes(2);
      expect(calls[1].paths).toEqual([{ changedOnly: false, path: "/v/b.md" }]);
      await settle();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      // A failed assertion above must not leave the listener on the process for later tests.
      process.off("unhandledRejection", unhandled);
    }
  });
});
