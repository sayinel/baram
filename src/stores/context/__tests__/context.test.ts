// §81 contextStore unit tests
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock IPC context module before store import
vi.mock("../../../ipc/context", () => ({
  addContext: vi.fn(async (info: unknown) => info),
  removeContext: vi.fn(async () => undefined),
  setActiveContext: vi.fn(async () => undefined),
  getContexts: vi.fn(async () => []),
}));

// Mock tauriStorage to be a no-op in-memory storage
vi.mock("../../system/tauri-storage", () => ({
  tauriStorage: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { useContextStore } from "../context";

describe("§81 contextStore", () => {
  beforeEach(async () => {
    // Flush microtasks from persist middleware
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    // Reset to empty state
    useContextStore.setState({ contexts: [], activeContextId: null });
  });

  it("starts with empty contexts", () => {
    const state = useContextStore.getState();
    expect(state.contexts).toEqual([]);
    expect(state.activeContextId).toBeNull();
  });

  it("adds a context and auto-activates first", async () => {
    await useContextStore.getState().addContext("vault", "/Users/test/notes");
    const state = useContextStore.getState();
    expect(state.contexts).toHaveLength(1);
    expect(state.contexts[0].path).toBe("/Users/test/notes");
    expect(state.contexts[0].label).toBe("notes");
    expect(state.activeContextId).toBe(state.contexts[0].id);
  });

  it("removes a context", async () => {
    await useContextStore.getState().addContext("vault", "/Users/test/notes");
    const { contexts } = useContextStore.getState();
    const id = contexts[0].id;
    await useContextStore.getState().removeContext(id);
    expect(useContextStore.getState().contexts).toHaveLength(0);
  });

  it("switches active to next context on active removal", async () => {
    await useContextStore.getState().addContext("vault", "/Users/test/a");
    await useContextStore.getState().addContext("vault", "/Users/test/b");
    const { contexts } = useContextStore.getState();
    const firstId = contexts[0].id;
    const secondId = contexts[1].id;
    // Manually set active to first
    useContextStore.setState({ activeContextId: firstId });
    await useContextStore.getState().removeContext(firstId);
    // Should fall back to next remaining context
    expect(useContextStore.getState().activeContextId).toBe(secondId);
  });

  it("getContextForPath finds matching context", async () => {
    await useContextStore.getState().addContext("vault", "/Users/test/notes");
    const found = useContextStore
      .getState()
      .getContextForPath("/Users/test/notes/foo.md");
    expect(found).not.toBeNull();
    expect(found!.path).toBe("/Users/test/notes");
  });

  it("getContextForPath returns null for unmatched path", async () => {
    await useContextStore.getState().addContext("vault", "/Users/test/notes");
    const found = useContextStore
      .getState()
      .getContextForPath("/Users/other/file.md");
    expect(found).toBeNull();
  });

  it("vaultContexts filters by type", async () => {
    await useContextStore.getState().addContext("vault", "/Users/test/a");
    await useContextStore.getState().addContext("folder", "/Users/test/b");
    const vaults = useContextStore.getState().vaultContexts();
    expect(vaults).toHaveLength(1);
    expect(vaults[0].contextType).toBe("vault");
  });

  it("reorderContexts changes order", async () => {
    await useContextStore.getState().addContext("vault", "/a");
    await useContextStore.getState().addContext("vault", "/b");
    await useContextStore.getState().addContext("vault", "/c");
    const { contexts } = useContextStore.getState();
    const ids = contexts.map((c) => c.id);
    // Reverse order
    const reversed = [...ids].reverse();
    useContextStore.getState().reorderContexts(reversed);
    const reordered = useContextStore.getState().contexts;
    expect(reordered.map((c) => c.id)).toEqual(reversed);
  });

  it("§85 ensureJournalContext pins journal to position 1", async () => {
    // Add two vault contexts first
    await useContextStore.getState().addContext("vault", "/a");
    await useContextStore.getState().addContext("vault", "/b");
    // Now add journal — should be pinned to index 1
    await useContextStore.getState().ensureJournalContext("/journal");
    const { contexts } = useContextStore.getState();
    expect(contexts).toHaveLength(3);
    expect(contexts[1].vaultType).toBe("journal");
    expect(contexts[1].path).toBe("/journal");
  });

  it("§85 addContext keeps journal at position 1 when adding after journal", async () => {
    await useContextStore.getState().addContext("vault", "/a");
    await useContextStore.getState().ensureJournalContext("/journal");
    // Journal should be at position 1
    expect(useContextStore.getState().contexts[1].vaultType).toBe("journal");
    // Add another context — journal should remain at position 1
    await useContextStore.getState().addContext("vault", "/c");
    const { contexts } = useContextStore.getState();
    expect(contexts).toHaveLength(3);
    expect(contexts[1].vaultType).toBe("journal");
  });
});
