// issue 597 — the startup restore waits for the persisted stores to rehydrate.
//
// `tauriStorage` rehydrates asynchronously (Rust IPC). Before this fix the
// once-only startup effect read `useContextStore.getState()` at mount, saw the
// empty default, took the "no vault to restore" path and locked itself; the
// real contexts arrived a moment later to an effect that never runs again.
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const addContextIpc = vi.hoisted(() => vi.fn(async (info: unknown) => info));
const openFolder = vi.hoisted(() => vi.fn(async (_p: string) => undefined));
const queuedUrls = vi.hoisted(() => ({ paths: [] as string[] }));
const getOpenedUrls = vi.hoisted(() => vi.fn(async () => queuedUrls.paths));
/** The `file:open-request` listeners the hook installed, so a test can fire one. */
const hotOpen = vi.hoisted(() => ({
  listeners: [] as ((e: { payload: string }) => void)[],
}));
const storage = vi.hoisted(() => {
  // One deferred read per key: the test decides WHEN persisted state lands.
  const pending = new Map<string, (v: null | string) => void>();
  return {
    getItem: vi.fn(
      (name: string) =>
        new Promise<null | string>((resolve) => {
          pending.set(name, resolve);
        }),
    ),
    pending,
    removeItem: vi.fn(async () => undefined),
    setItem: vi.fn(async () => undefined),
  };
});

vi.mock("../../stores/system/tauri-storage", () => ({
  tauriStorage: {
    getItem: (n: string) => storage.getItem(n),
    removeItem: storage.removeItem,
    setItem: storage.setItem,
  },
}));
vi.mock("../../ipc/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/context")>()),
  addContext: (info: unknown) => addContextIpc(info),
  setActiveContext: vi.fn(async () => undefined),
}));
vi.mock("../../ipc/approval", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/approval")>()),
  isPathApproved: vi.fn(async () => true),
}));
vi.mock("../../ipc/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/config")>()),
  getConfig: vi.fn(async () => "en"),
  setConfig: vi.fn(async () => undefined),
}));
vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  getOpenedUrls: () => getOpenedUrls(),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, cb: (e: { payload: string }) => void) => {
    hotOpen.listeners.push(cb);
    return () => {};
  }),
}));
vi.mock("../../services/vault-context-loader", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../services/vault-context-loader")
  >()),
  openFolder: (p: string) => openFolder(p),
}));
vi.mock("../../spaces", () => ({ getSpace: () => undefined }));

const VAULT = "/x/LastSessionVault";
const persistedContexts = JSON.stringify({
  state: {
    activeContextId: "ctx-1",
    contexts: [
      {
        addedAt: 0,
        color: "#fff",
        contextType: "vault",
        id: "ctx-1",
        label: "LastSessionVault",
        path: VAULT,
      },
    ],
  },
  version: 1,
});

/**
 * A fresh hook module and fresh stores for every test. The hook keeps its
 * startup coordination in module state (`startupPending`, the cold-start drain
 * guard, the queued-path set), and a first test that ran the restore would
 * otherwise leave the drain guard set for every test after it — the dedup
 * path would then never be exercised and its assertions would hold vacuously.
 * Importing the store from the same fresh registry keeps it the instance the
 * hook uses; its initial hydration is already waiting on `storage`.
 */
async function freshHarness() {
  vi.resetModules();
  const [{ useContextStore }, { useAppStartup }] = await Promise.all([
    import("../../stores/context/context"),
    import("../use-app-startup"),
  ]);
  return { useAppStartup, useContextStore };
}

/** Let every storage read that is waiting land with the given payloads. */
function land(payloads: Record<string, null | string>): void {
  for (const [name, resolve] of storage.pending) {
    resolve(payloads[name] ?? null);
    storage.pending.delete(name);
  }
}

beforeEach(() => {
  addContextIpc.mockClear();
  openFolder.mockClear();
  getOpenedUrls.mockClear();
  storage.pending.clear();
  queuedUrls.paths = [];
  hotOpen.listeners.length = 0;
});

describe("useAppStartup waits for hydration (issue 597)", () => {
  it("re-registers and reopens last session's vault even when storage answers late", async () => {
    const { useAppStartup, useContextStore } = await freshHarness();
    // The stores' first read has not answered yet.
    expect(useContextStore.persist.hasHydrated()).toBe(false);

    renderHook(() =>
      useAppStartup({
        handleNewFile: vi.fn(),
        handleOpenFilePath: vi.fn(async () => {}),
      }),
    );
    // Nothing happened yet: the effect is waiting, not deciding on defaults.
    await new Promise((r) => setTimeout(r, 0));
    expect(addContextIpc).not.toHaveBeenCalled();
    expect(openFolder).not.toHaveBeenCalled();

    // Storage answers: the persisted vault exists.
    land({ "baram:context": persistedContexts });

    await waitFor(() => expect(openFolder).toHaveBeenCalledWith(VAULT));
    expect(addContextIpc).toHaveBeenCalledWith(
      expect.objectContaining({ path: VAULT }),
    );
  });
});

describe("hot file-open events during startup (issue 597)", () => {
  it("waits for the restore before opening, and does not reopen a path the cold-start queue delivered", async () => {
    const { useAppStartup } = await freshHarness();
    const handleOpenFilePath = vi.fn(async (_p: string) => {});
    const QUEUED = `${VAULT}/from-queue.md`;
    const HOT = `${VAULT}/hot.md`;
    queuedUrls.paths = [QUEUED];

    renderHook(() =>
      useAppStartup({ handleNewFile: vi.fn(), handleOpenFilePath }),
    );
    await waitFor(() => expect(hotOpen.listeners.length).toBeGreaterThan(0));

    // Finder opens two files while the stores are still hydrating: one that
    // Rust also queued for the cold start, one it did not.
    for (const listener of hotOpen.listeners) {
      listener({ payload: QUEUED });
      listener({ payload: HOT });
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(handleOpenFilePath).not.toHaveBeenCalled();

    land({ "baram:context": persistedContexts });

    await waitFor(() => expect(handleOpenFilePath).toHaveBeenCalledWith(HOT));
    // The cold-start queue WAS drained in this test (not a leftover guard from
    // an earlier one), and the queued path was opened by that drain — once.
    expect(getOpenedUrls).toHaveBeenCalledTimes(1);
    expect(
      handleOpenFilePath.mock.calls.filter(([p]) => p === QUEUED),
    ).toHaveLength(1);
    // And the restore ran before either open.
    expect(openFolder).toHaveBeenCalledWith(VAULT);
    const openFolderOrder = openFolder.mock.invocationCallOrder[0]!;
    for (const order of handleOpenFilePath.mock.invocationCallOrder) {
      expect(order).toBeGreaterThan(openFolderOrder);
    }

    // Long after startup the user closes that file and opens it from Finder
    // again: this is a new request, not the twin of the queued one.
    for (const listener of hotOpen.listeners) listener({ payload: QUEUED });
    await waitFor(() =>
      expect(
        handleOpenFilePath.mock.calls.filter(([p]) => p === QUEUED),
      ).toHaveLength(2),
    );
  });

  it("opens a hot request that names no queued path, even during startup", async () => {
    const { useAppStartup } = await freshHarness();
    const handleOpenFilePath = vi.fn(async (_p: string) => {});
    const HOT = `${VAULT}/only-hot.md`;
    queuedUrls.paths = [`${VAULT}/from-queue.md`];

    renderHook(() =>
      useAppStartup({ handleNewFile: vi.fn(), handleOpenFilePath }),
    );
    await waitFor(() => expect(hotOpen.listeners.length).toBeGreaterThan(0));
    for (const listener of hotOpen.listeners) listener({ payload: HOT });
    land({ "baram:context": persistedContexts });

    await waitFor(() => expect(handleOpenFilePath).toHaveBeenCalledWith(HOT));
    expect(handleOpenFilePath).toHaveBeenCalledTimes(2);
  });
});
