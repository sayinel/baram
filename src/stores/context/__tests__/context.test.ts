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

  it("§85/§93 ensureJournalContext pins journal to the front (no zettel)", async () => {
    // Add two vault contexts first
    await useContextStore.getState().addContext("vault", "/a");
    await useContextStore.getState().addContext("vault", "/b");
    // Now add journal — with no zettel present it becomes index 0
    await useContextStore.getState().ensureJournalContext("/journal");
    const { contexts } = useContextStore.getState();
    expect(contexts).toHaveLength(3);
    expect(contexts[0].vaultType).toBe("journal");
    expect(contexts[0].path).toBe("/journal");
  });

  it("§85/§93 addContext keeps journal pinned to the front (no zettel)", async () => {
    await useContextStore.getState().addContext("vault", "/a");
    await useContextStore.getState().ensureJournalContext("/journal");
    // Journal should be at the front
    expect(useContextStore.getState().contexts[0].vaultType).toBe("journal");
    // Add another context — journal should remain at the front
    await useContextStore.getState().addContext("vault", "/c");
    const { contexts } = useContextStore.getState();
    expect(contexts).toHaveLength(3);
    expect(contexts[0].vaultType).toBe("journal");
  });
});

describe("§92 space-generic context helpers", () => {
  beforeEach(async () => {
    // Flush microtasks from persist middleware
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    // Reset to empty state
    useContextStore.setState({ contexts: [], activeContextId: null });
  });

  it("spaceContext returns null when no vault of that type exists", () => {
    expect(useContextStore.getState().spaceContext("zettelkasten")).toBeNull();
  });

  it("journalContext equals spaceContext('journal')", () => {
    const s = useContextStore.getState();
    expect(s.journalContext()).toBe(s.spaceContext("journal"));
  });

  it("ensureSpaceContext creates and activates a new vault context", async () => {
    const ctx = await useContextStore
      .getState()
      .ensureSpaceContext("zettelkasten", "/zk", { label: "zettelkasten" });
    const state = useContextStore.getState();
    expect(ctx.vaultType).toBe("zettelkasten");
    expect(ctx.path).toBe("/zk");
    expect(state.activeContextId).toBe(ctx.id);
    expect(state.spaceContext("zettelkasten")).toBe(ctx);
  });

  it("ensureSpaceContext activates (not duplicates) an existing vault context", async () => {
    const first = await useContextStore
      .getState()
      .ensureSpaceContext("zettelkasten", "/zk");
    // Simulate a different active context, then ensure again
    await useContextStore.getState().addContext("vault", "/other");
    useContextStore
      .getState()
      ._setActiveContextLocal(
        useContextStore.getState().contexts.find((c) => c.path === "/other")!
          .id,
      );
    const second = await useContextStore
      .getState()
      .ensureSpaceContext("zettelkasten", "/zk");
    const state = useContextStore.getState();
    expect(second.id).toBe(first.id);
    expect(
      state.contexts.filter((c) => c.vaultType === "zettelkasten"),
    ).toHaveLength(1);
    expect(state.activeContextId).toBe(first.id);
  });

  it("ensureJournalContext pins journal to the front (no zettel) and uses green color", async () => {
    await useContextStore.getState().addContext("vault", "/a");
    await useContextStore.getState().addContext("vault", "/b");
    const ctx = await useContextStore
      .getState()
      .ensureJournalContext("/journal");
    const state = useContextStore.getState();
    expect(state.contexts).toHaveLength(3);
    expect(state.contexts[0].vaultType).toBe("journal");
    expect(ctx.color).toBe("#10b981");
    expect(state.activeContextId).toBe(ctx.id);
  });
});

describe("§93 space tab pinning order", () => {
  beforeEach(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    useContextStore.setState({ contexts: [], activeContextId: null });
  });

  it("pins zettelkasten to the front (index 0)", async () => {
    await useContextStore.getState().addContext("vault", "/a");
    await useContextStore.getState().addContext("vault", "/b");
    await useContextStore
      .getState()
      .ensureSpaceContext("zettelkasten", "/zk", { label: "zettelkasten" });
    const { contexts } = useContextStore.getState();
    expect(contexts).toHaveLength(3);
    expect(contexts[0].vaultType).toBe("zettelkasten");
  });

  it("orders zettel first, journal second when both exist", async () => {
    await useContextStore.getState().addContext("vault", "/notes");
    await useContextStore.getState().ensureJournalContext("/journal");
    await useContextStore
      .getState()
      .ensureSpaceContext("zettelkasten", "/zk", { label: "zettelkasten" });
    const { contexts } = useContextStore.getState();
    expect(contexts.map((c) => c.vaultType ?? "general")).toEqual([
      "zettelkasten",
      "journal",
      "general",
    ]);
  });

  it("journal is index 0 with no zettel, bumps to index 1 once zettel is added", async () => {
    await useContextStore.getState().addContext("vault", "/notes");
    await useContextStore.getState().ensureJournalContext("/journal");
    // No zettel yet → journal is first
    expect(useContextStore.getState().contexts[0].vaultType).toBe("journal");
    // Adding zettel bumps journal to index 1
    await useContextStore
      .getState()
      .ensureSpaceContext("zettelkasten", "/zk", { label: "zettelkasten" });
    const { contexts } = useContextStore.getState();
    expect(contexts[0].vaultType).toBe("zettelkasten");
    expect(contexts[1].vaultType).toBe("journal");
  });

  it("keeps pinned order after a regular vault is added later", async () => {
    await useContextStore
      .getState()
      .ensureSpaceContext("zettelkasten", "/zk", { label: "zettelkasten" });
    await useContextStore.getState().ensureJournalContext("/journal");
    await useContextStore.getState().addContext("vault", "/late");
    const { contexts } = useContextStore.getState();
    expect(contexts[0].vaultType).toBe("zettelkasten");
    expect(contexts[1].vaultType).toBe("journal");
    expect(contexts[2].path).toBe("/late");
  });
});
