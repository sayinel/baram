// §393 — the hook's wiring: watcher events → `syncIndexPaths` → the backlinks panel re-reads when
// the link index changed, and `vault:changed` is published for each context. Timing and seriality
// live in the batcher's own test.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { syncIndexPaths } = vi.hoisted(() => ({ syncIndexPaths: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../../ipc/invoke", () => ({ syncIndexPaths }));

import { listen } from "@tauri-apps/api/event";

import type { IndexSyncAnswer } from "../../ipc/types";

import { onNoteChanges } from "../../services/note-changes";
import { VAULT_SYNC_QUIET_MS } from "../../services/vault-change-batcher";
import { subscribeVaultChanges } from "../../services/vault-changes";
import { useLinkStore } from "../../stores/editor/link";
import { useVaultChangeSync } from "../use-vault-change-sync";

const handlers = new Map<string, (e: { payload: unknown }) => void>();

/** Let the hook's async `listen` registration and the batcher's continuations run. */
const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });

/** Mount the hook, report one changed path and let the batch reach `syncIndexPaths`. */
async function syncOnePath() {
  renderHook(() => useVaultChangeSync());
  await flush();
  act(() => {
    handlers.get("file:changed")?.({ payload: { mtime: 1, path: "/v/a.md" } });
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(VAULT_SYNC_QUIET_MS);
  });
  await flush();
}

describe("useVaultChangeSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    handlers.clear();
    syncIndexPaths.mockReset();
    vi.mocked(listen).mockImplementation(async (event, handler) => {
      handlers.set(event, handler as (e: { payload: unknown }) => void);
      return () => handlers.delete(event);
    });
  });
  afterEach(() => vi.useRealTimers());

  describe("§34 what a reader of the notes' text hears (issue 791)", () => {
    const heardFor = async (answer: IndexSyncAnswer) => {
      syncIndexPaths.mockResolvedValue(answer);
      const heard: Array<null | string[]> = [];
      const stop = onNoteChanges((paths) => heard.push(paths && [...paths]));
      try {
        await syncOnePath();
      } finally {
        stop();
      }
      return heard;
    };

    // Fails if `announce` does not pass `notes` on.
    it("names the notes the sync named, links unchanged", async () => {
      expect(
        await heardFor({
          contexts: ["ctx-1"],
          linksChanged: false,
          notes: ["/v/a.md"],
          treeChanged: false,
        }),
      ).toEqual([["/v/a.md"]]);
    });

    // Fails if `linksChanged` turns into the unnamed announcement: with no live index every save
    // of the viewed note answers `linksChanged`, and each would walk the vault.
    it("still only names them when the link index changed", async () => {
      expect(
        await heardFor({
          contexts: ["ctx-1"],
          linksChanged: true,
          notes: ["/v/a.md"],
          treeChanged: false,
        }),
      ).toEqual([["/v/a.md"]]);
    });

    // Fails if `treeChanged` is not read — a folder renamed or moved names no note — or if a batch
    // with both announces twice, which runs a second walk over the same disk.
    it("announces once, unnamed, when the tree changed", async () => {
      expect(
        await heardFor({
          contexts: ["ctx-1"],
          linksChanged: true,
          notes: ["/v/a.md"],
          treeChanged: true,
        }),
      ).toEqual([null]);
    });

    // Fails if `announceNoteChanges` tells listeners of an empty list.
    it("announces nothing when the batch changed no note", async () => {
      expect(
        await heardFor({
          contexts: ["ctx-1"],
          linksChanged: true,
          notes: [],
          treeChanged: false,
        }),
      ).toEqual([]);
    });
  });

  it("syncs the touched paths, then invalidates the panel and publishes each context", async () => {
    // Fails if `announce` does not invalidate when `linksChanged` (the second `indexVersion` check).
    let release: (answer: IndexSyncAnswer) => void = () => undefined;
    syncIndexPaths.mockImplementation(
      () => new Promise<IndexSyncAnswer>((resolve) => (release = resolve)),
    );
    const heard: string[] = [];
    const stop = subscribeVaultChanges((id) => heard.push(id));
    const version = useLinkStore.getState().indexVersion;
    renderHook(() => useVaultChangeSync());
    await flush();
    expect([...handlers.keys()].sort()).toEqual([
      "file:changed",
      "file:created",
      "file:deleted",
    ]);

    act(() => {
      handlers.get("file:deleted")?.({ payload: { path: "/v/old.md" } });
      handlers.get("file:changed")?.({
        payload: { mtime: 1, path: "/v/a.md" },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VAULT_SYNC_QUIET_MS);
    });
    expect(syncIndexPaths).toHaveBeenCalledWith([
      { changedOnly: false, path: "/v/old.md" },
      { changedOnly: true, path: "/v/a.md" },
    ]);
    expect(heard).toEqual([]);
    expect(useLinkStore.getState().indexVersion).toBe(version);

    act(() =>
      release({
        contexts: ["ctx-1", "ctx-2"],
        linksChanged: true,
        notes: [],
        treeChanged: false,
      }),
    );
    await flush();
    expect(useLinkStore.getState().indexVersion).toBe(version + 1);
    expect(heard).toEqual(["ctx-1", "ctx-2"]);
    stop();
  });

  it("publishes each context but leaves the panel alone when the link index did not change", async () => {
    // The watcher's echo of an auto-save. Fails if `announce` invalidates on every answer — the
    // backlinks panel and the graph would re-read once more per save. The publish half fails if
    // `linksChanged` gates the plugins' signal too.
    syncIndexPaths.mockResolvedValue({
      contexts: ["ctx-1", "ctx-2"],
      linksChanged: false,
      notes: ["/v/a.md"],
      treeChanged: false,
    });
    const heard: string[] = [];
    const stop = subscribeVaultChanges((id) => heard.push(id));
    const version = useLinkStore.getState().indexVersion;

    await syncOnePath();

    expect(syncIndexPaths).toHaveBeenCalledTimes(1);
    expect(useLinkStore.getState().indexVersion).toBe(version);
    expect(heard).toEqual(["ctx-1", "ctx-2"]);
    stop();
  });

  it("stops listening on unmount", async () => {
    const { unmount } = renderHook(() => useVaultChangeSync());
    await flush();
    expect(handlers.size).toBe(3);
    unmount();
    expect(handlers.size).toBe(0);
  });

  it("unlistens every registration that resolves after unmount", async () => {
    // Fails if the `cancelled` branch is deleted: the late registrations stay in `handlers`.
    const resolvers: Array<() => void> = [];
    vi.mocked(listen).mockImplementation(
      (event, handler) =>
        new Promise((resolve) => {
          resolvers.push(() => {
            handlers.set(event, handler as (e: { payload: unknown }) => void);
            resolve(() => handlers.delete(event));
          });
        }),
    );
    const { unmount } = renderHook(() => useVaultChangeSync());
    unmount();
    resolvers.forEach((r) => r());
    await flush();
    expect(resolvers).toHaveLength(3);
    expect(handlers.size).toBe(0);
  });

  it("unlistens the registrations that succeeded when one listen rejects", async () => {
    // Fails with `Promise.all`: the rejection leaves the two that registered listening.
    vi.mocked(listen).mockImplementation(async (event, handler) => {
      if (event === "file:created") throw new Error("listen boom");
      handlers.set(event, handler as (e: { payload: unknown }) => void);
      return () => handlers.delete(event);
    });
    renderHook(() => useVaultChangeSync());
    await flush();
    expect(handlers.size).toBe(0);
  });
});
