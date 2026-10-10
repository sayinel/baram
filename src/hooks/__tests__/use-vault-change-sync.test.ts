// §393 — the hook's wiring: watcher events → `syncIndexPaths` → the backlinks panel re-reads and
// `vault:changed` is published for each context, in that order. Timing and seriality live in the
// batcher's own test.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { syncIndexPaths } = vi.hoisted(() => ({ syncIndexPaths: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../../ipc/invoke", () => ({ syncIndexPaths }));

import { listen } from "@tauri-apps/api/event";

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

  it("syncs the touched paths, then invalidates the panel and publishes each context", async () => {
    let release: (ids: string[]) => void = () => undefined;
    syncIndexPaths.mockImplementation(
      () => new Promise<string[]>((resolve) => (release = resolve)),
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

    act(() => release(["ctx-1", "ctx-2"]));
    await flush();
    expect(useLinkStore.getState().indexVersion).toBe(version + 1);
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
