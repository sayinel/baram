// §81 contextStore unit tests
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock IPC context module before store import
const { ipcAddContext, ipcRemoveContext } = vi.hoisted(() => ({
  ipcAddContext: vi.fn(async (info: unknown) => info),
  ipcRemoveContext: vi.fn(async () => undefined),
}));
vi.mock("../../../ipc/context", () => ({
  addContext: ipcAddContext,
  removeContext: ipcRemoveContext,
  setActiveContext: vi.fn(async () => undefined),
  getContexts: vi.fn(async () => []),
  updateContextAlias: vi.fn(async () => undefined),
  updateContextColor: vi.fn(async () => undefined),
  updateContextLabel: vi.fn(async () => undefined),
}));

// issue 598: an active space that moved is switched through the loader, which
// imports this store — mocked here to what the switch means for the store.
const { refreshInactiveContextIndex, switchContext } = vi.hoisted(() => ({
  refreshInactiveContextIndex: vi.fn(),
  switchContext: vi.fn(),
}));
vi.mock("../../../services/vault-context-loader", () => ({
  refreshInactiveContextIndex: (path: string, scope: string) =>
    refreshInactiveContextIndex(path, scope),
  switchContext: (id: string) => switchContext(id),
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
import { SpaceDirectoryTakenError } from "../errors";

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

  it("names a context after its last path segment, and the filesystem root after itself", async () => {
    // `basename("/")` is "" — a root vault used to keep "/" as its label and
    // alias, and must still (both persist; a blank tab would survive restart).
    const root = await useContextStore.getState().addContext("vault", "/");
    expect(root.label).toBe("/");
    expect(root.alias).toBe("/");
    const folder = await useContextStore
      .getState()
      .addContext("folder", "/Users/test/work/");
    expect(folder.label).toBe("work");
    expect(folder.alias).toBeUndefined();
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

  // §260 Phase 4a security re-review (LOW-2) — one point of truth for the stored path.
  it("addContext strips trailing separators from the stored path", async () => {
    // Five consumers compute a relative remainder from `ctx.path.length`, so a stored
    // root with a trailing separator was an off-by-one in each — and `journalDirectory`
    // is a user-editable field that can carry one.
    const created = await useContextStore
      .getState()
      .addContext("vault", "/Users/test/notes/");
    expect(created.path).toBe("/Users/test/notes");
    expect(
      useContextStore.getState().getContextForPath("/Users/test/notes/a.md")
        ?.id,
    ).toBe(created.id);
  });

  // §260 Phase 4a code review (I3) — this rule decides which vault a file belongs to,
  // and since Phase 4a it also decides what a sandboxed plugin may read. It had NO test
  // for its separator handling: a change here stayed green either way.
  describe("getContextForPath separator handling", () => {
    /** Contexts are inserted directly: `addContext` canonicalises through Rust. */
    const withRoots = (...paths: string[]) =>
      useContextStore.setState({
        contexts: paths.map((path, i) => ({
          added_at: i,
          color: "#000",
          context_type: "vault",
          contextType: "vault",
          id: `ctx-${i}`,
          label: path,
          path,
        })) as never,
      });
    const idFor = (p: string) =>
      useContextStore.getState().getContextForPath(p)?.id ?? null;

    it("requires a separator after the root", () => {
      withRoots("/Users/me/work");
      expect(idFor("/Users/me/work/note.md")).toBe("ctx-0");
      // The reason the check exists: a sibling whose name merely starts the same.
      expect(idFor("/Users/me/workspace/note.md")).toBeNull();
      // The root itself is not a file inside it.
      expect(idFor("/Users/me/work")).toBeNull();
    });

    it("matches a Windows root, which is backslash-delimited on both sides", () => {
      // Appending "/" (the original rule) matched nothing here, so EVERY caller got
      // "no context" on Windows — including the §260 event bridge, which then delivers
      // no file events at all.
      withRoots("C:\\Users\\me\\vault");
      expect(idFor("C:\\Users\\me\\vault\\note.md")).toBe("ctx-0");
      expect(idFor("C:\\Users\\me\\vault-other\\note.md")).toBeNull();
    });

    it("matches a POSIX root that contains a backslash", () => {
      // A backslash is a legal character in a POSIX directory name, so the separator
      // cannot be INFERRED from the root — inferring it broke this case while fixing
      // Windows. Tested at the boundary instead.
      withRoots("/home/me/my\\dir");
      expect(idFor("/home/me/my\\dir/note.md")).toBe("ctx-0");
    });

    it("tolerates a trailing separator on the root", () => {
      withRoots("/Users/me/work/");
      expect(idFor("/Users/me/work/note.md")).toBe("ctx-0");
    });

    it("prefers the innermost of nested roots", () => {
      // Which one wins decides which root a plugin's relative path resolves against.
      withRoots("/vaults/a", "/vaults/a/nested");
      expect(idFor("/vaults/a/nested/deep/note.md")).toBe("ctx-1");
      expect(idFor("/vaults/a/other/note.md")).toBe("ctx-0");
    });
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

// §88 — the Rust ContextManager dedups by canonical path and returns the EXISTING
// entry (`context/manager.rs:62-70`, pinned by its own `add_dedup_returns_existing`
// test). The store appended that response unconditionally, so a dedup hit produced a
// second entry carrying an id it already had — duplicate React keys in the context tab
// bar, and a list that grows once per call, persisted. Reachable whenever the journal
// directory is a path that is already registered (the vault root, a folder opened with
// "+", or a symlink/case variant that canonicalizes to the same path).
describe("§88 addContext — a dedup response must not append", () => {
  beforeEach(() => {
    ipcAddContext.mockClear();
    ipcAddContext.mockImplementation(async (info: unknown) => info);
    useContextStore.setState({ activeContextId: null, contexts: [] });
  });

  it("returns the existing context instead of appending a duplicate id", async () => {
    const first = await useContextStore
      .getState()
      .addContext("vault", "/Users/test/notes");
    expect(useContextStore.getState().contexts).toHaveLength(1);

    // Rust canonicalizes /tmp → /private/tmp (and dedups symlinks, case variants,
    // the vault root itself), so a DIFFERENT requested path can come back as `first`.
    ipcAddContext.mockImplementationOnce(async () => first);
    const second = await useContextStore
      .getState()
      .addContext("vault", "/Users/test/notes-symlink", {
        vaultType: "journal",
      });

    expect(second.id).toBe(first.id);
    expect(useContextStore.getState().contexts).toHaveLength(1);
    const ids = useContextStore.getState().contexts.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// §85/§89 — registering a space directory and SWITCHING to it are different acts.
//
// `ensureSpaceContext` activated unconditionally, and the subscription in
// `stores/file/file.ts:726` syncs only `rootPath` — not the file tree (its own comment
// says so, and the zettel preset compensates with an explicit `switchContext`). So a
// caller that only needs the directory registered so the backend permits writing to it
// would silently repoint `rootPath` away from the tree still on screen.
describe("§85 ensureJournalContext — activation is opt-out", () => {
  beforeEach(() => {
    ipcAddContext.mockClear();
    ipcAddContext.mockImplementation(async (info: unknown) => info);
    useContextStore.setState({ activeContextId: null, contexts: [] });
  });

  it("registers without activating when activation is declined", async () => {
    const vault = await useContextStore
      .getState()
      .addContext("vault", "/Users/test/vault");
    expect(useContextStore.getState().activeContextId).toBe(vault.id);

    const journal = await useContextStore
      .getState()
      .ensureJournalContext("/Users/test/journal", { activate: false });

    expect(useContextStore.getState().contexts).toHaveLength(2);
    expect(journal.vaultType).toBe("journal");
    // The point: the workspace did not move.
    expect(useContextStore.getState().activeContextId).toBe(vault.id);
  });

  it("still activates by default, and when an existing journal context is found", async () => {
    await useContextStore.getState().addContext("vault", "/Users/test/vault");

    const journal = await useContextStore
      .getState()
      .ensureJournalContext("/Users/test/journal");
    expect(useContextStore.getState().activeContextId).toBe(journal.id);

    // Existing-context branch: also declines activation when asked. The active
    // context must be moved AWAY from the journal explicitly — `addContext` only
    // auto-activates the very first context, so simply adding another one would
    // leave the journal active and this assertion would hold either way.
    const other = await useContextStore
      .getState()
      .addContext("vault", "/Users/test/other");
    useContextStore.setState({ activeContextId: other.id });
    await useContextStore
      .getState()
      .ensureJournalContext("/Users/test/journal", { activate: false });
    expect(useContextStore.getState().activeContextId).toBe(other.id);
  });
});

describe("issue 598 ensureSpaceContext — a space whose directory setting moved", () => {
  beforeEach(async () => {
    await new Promise((r) => setTimeout(r, 0));
    useContextStore.setState({ contexts: [], activeContextId: null });
    ipcAddContext.mockClear();
    ipcRemoveContext.mockClear();
    ipcAddContext.mockImplementation(async (info: unknown) => info);
    refreshInactiveContextIndex.mockClear();
    switchContext.mockReset();
    switchContext.mockImplementation(async (id: string) => {
      useContextStore.getState()._setActiveContextLocal(id);
    });
  });

  it("registers the new directory, retires the old one, and keeps label, colour and alias", async () => {
    const old = await useContextStore
      .getState()
      .ensureSpaceContext("journal", "/vault/journal", {
        color: "#10b981",
        label: "journal",
      });
    useContextStore.getState().updateContextAlias(old.id, "diary");

    const moved = await useContextStore
      .getState()
      .ensureSpaceContext("journal", "/elsewhere/journal");

    const { contexts } = useContextStore.getState();
    expect(moved.path).toBe("/elsewhere/journal");
    expect(moved.id).not.toBe(old.id);
    expect(moved.label).toBe("journal");
    expect(moved.color).toBe("#10b981");
    expect(moved.alias).toBe("diary");
    expect(contexts.filter((c) => c.vaultType === "journal")).toHaveLength(1);
    expect(contexts.find((c) => c.id === old.id)).toBeUndefined();
    // Rust heard both halves, new first.
    expect(ipcAddContext).toHaveBeenCalledTimes(2);
    expect(ipcRemoveContext).toHaveBeenCalledWith(old.id);
  });

  it("returns the existing context when the directory only differs by a trailing separator", async () => {
    const first = await useContextStore
      .getState()
      .ensureSpaceContext("zettelkasten", "/vault/zk");
    ipcAddContext.mockClear();
    const again = await useContextStore
      .getState()
      .ensureSpaceContext("zettelkasten", "/vault/zk/");
    expect(again.id).toBe(first.id);
    expect(ipcAddContext).not.toHaveBeenCalled();
    expect(ipcRemoveContext).not.toHaveBeenCalled();
  });

  it("switches to the new directory when the old one was on screen, even without activate", async () => {
    const old = await useContextStore
      .getState()
      .ensureSpaceContext("journal", "/vault/journal");
    expect(useContextStore.getState().activeContextId).toBe(old.id);

    const moved = await useContextStore
      .getState()
      .ensureSpaceContext("journal", "/elsewhere/journal", {
        activate: false,
      });
    // The tab-bar switch: Rust root, file tree and link index follow — not the
    // local-only activation a "register only" caller would otherwise get.
    expect(switchContext).toHaveBeenCalledWith(moved.id);
    expect(useContextStore.getState().activeContextId).toBe(moved.id);
  });
  it("leaves the active context alone when the old one was not active and activation was declined", async () => {
    const old = await useContextStore
      .getState()
      .ensureSpaceContext("journal", "/vault/journal", { activate: false });
    const other = await useContextStore
      .getState()
      .addContext("vault", "/other");
    useContextStore.getState()._setActiveContextLocal(other.id);

    await useContextStore
      .getState()
      .ensureSpaceContext("journal", "/elsewhere/journal", {
        activate: false,
      });
    expect(useContextStore.getState().activeContextId).toBe(other.id);
    expect(
      useContextStore.getState().contexts.find((c) => c.id === old.id),
    ).toBeUndefined();
    expect(switchContext).not.toHaveBeenCalled();
    // Nothing switched, so nothing else would build the new directory's link
    // index (issue 263) — the move asks for it, as the Folder↔Vault convert does.
    expect(refreshInactiveContextIndex).toHaveBeenCalledWith(
      "/elsewhere/journal",
      expect.any(String),
    );
  });

  it("switches when activation is asked for, even if the old context was not on screen", async () => {
    await useContextStore
      .getState()
      .ensureSpaceContext("journal", "/vault/journal", { activate: false });
    const other = await useContextStore
      .getState()
      .addContext("vault", "/other");
    useContextStore.getState()._setActiveContextLocal(other.id);

    const moved = await useContextStore
      .getState()
      .ensureSpaceContext("journal", "/elsewhere/journal");
    // Not a local activation: a switch, so Rust's root and the tree follow.
    expect(switchContext).toHaveBeenCalledWith(moved.id);
    // The switch rebuilds the index itself; asking twice would scan twice.
    expect(refreshInactiveContextIndex).not.toHaveBeenCalled();
  });

  it("re-homes the retired context's open tabs: old-directory files get a FileContext, the rest follow the space", async () => {
    const { useEditorStore } = await import("../../editor/editor");
    const old = await useContextStore
      .getState()
      .ensureSpaceContext("journal", "/vault/journal", { activate: false });
    useEditorStore.setState({
      tabs: [
        {
          contextId: old.id,
          filePath: "/vault/journal/2026-09-09.md",
          id: "t-file",
          isDirty: true,
          isPinned: false,
          title: "2026-09-09.md",
          type: "file",
        },
        {
          contextId: old.id,
          filePath: "",
          id: "t-graph",
          isDirty: false,
          isPinned: false,
          title: "Graph",
          type: "graph",
        },
        {
          contextId: "elsewhere",
          filePath: "/x/a.md",
          id: "t-other",
          isDirty: false,
          isPinned: false,
          title: "a.md",
          type: "file",
        },
      ],
    } as never);

    const transitions = vi.fn();
    const unsubscribe = useEditorStore.subscribe(transitions);
    const moved = await useContextStore
      .getState()
      .ensureSpaceContext("journal", "/elsewhere/journal", { activate: false });
    unsubscribe();
    // One transition for the re-homed files, one for the rest of the space —
    // not one per tab (every editor subscriber wakes on each).
    expect(transitions).toHaveBeenCalledTimes(2);

    const tabs = useEditorStore.getState().tabs;
    const fileTab = tabs.find((t) => t.id === "t-file")!;
    const home = useContextStore
      .getState()
      .contexts.find((c) => c.id === fileTab.contextId);
    // The dirty journal page is now a standalone FileContext at its own path —
    // still registered, so it can still be saved.
    expect(home?.contextType).toBe("file");
    expect(home?.path).toBe("/vault/journal/2026-09-09.md");
    expect(fileTab.isDirty).toBe(true);
    // A non-file tab of the space follows the space; an unrelated tab is untouched.
    expect(tabs.find((t) => t.id === "t-graph")!.contextId).toBe(moved.id);
    expect(tabs.find((t) => t.id === "t-other")!.contextId).toBe("elsewhere");
  });

  it("finishes the move when one tab cannot be given a home: that tab follows the space, no tab keeps the retired id", async () => {
    const { useEditorStore } = await import("../../editor/editor");
    const old = await useContextStore
      .getState()
      .ensureSpaceContext("journal", "/vault/journal");
    useEditorStore.setState({
      tabs: [
        {
          contextId: old.id,
          filePath: "/vault/journal/kept.md",
          id: "t-kept",
          isDirty: false,
          isPinned: false,
          title: "kept.md",
          type: "file",
        },
        {
          contextId: old.id,
          filePath: "/vault/journal/deleted-outside.md",
          id: "t-gone",
          isDirty: true,
          isPinned: false,
          title: "deleted-outside.md",
          type: "file",
        },
        {
          contextId: old.id,
          filePath: "/vault/journal/later.md",
          id: "t-later",
          isDirty: false,
          isPinned: false,
          title: "later.md",
          type: "file",
        },
      ],
    } as never);
    // The backend refuses a FileContext for a path that no longer exists.
    ipcAddContext.mockImplementation(async (info: unknown) => {
      const { path } = info as { path: string };
      if (path === "/vault/journal/deleted-outside.md") {
        throw new Error(`Path does not exist: ${path}`);
      }
      return info;
    });

    const moved = await useContextStore
      .getState()
      .ensureSpaceContext("journal", "/elsewhere/journal");

    const { contexts } = useContextStore.getState();
    const tabs = useEditorStore.getState().tabs;
    const homeOf = (id: string) =>
      contexts.find((c) => c.id === tabs.find((t) => t.id === id)!.contextId);
    expect(homeOf("t-kept")?.path).toBe("/vault/journal/kept.md");
    expect(homeOf("t-later")?.path).toBe("/vault/journal/later.md");
    // The refused tab follows the space rather than keeping a dead id.
    expect(homeOf("t-gone")?.id).toBe(moved.id);
    expect(tabs.find((t) => t.id === "t-gone")!.isDirty).toBe(true);
    expect(tabs.some((t) => t.contextId === old.id)).toBe(false);
    // The rest of the move still happened — and the switch came BEFORE the
    // tabs were re-homed, so the active seat and `rootPath` never sat on an
    // unrelated context while those registrations ran.
    expect(contexts.find((c) => c.id === old.id)).toBeUndefined();
    expect(switchContext).toHaveBeenCalledWith(moved.id);
    const [, newDir, ...homes] = ipcAddContext.mock.invocationCallOrder;
    const switched = switchContext.mock.invocationCallOrder[0]!;
    expect(newDir).toBeLessThan(switched);
    expect(homes.length).toBeGreaterThan(0);
    for (const order of homes) expect(order).toBeGreaterThan(switched);
  });

  it("keeps the moved space pinned in front of the tab bar", async () => {
    await useContextStore.getState().addContext("vault", "/vault/notes");
    const old = await useContextStore
      .getState()
      .ensureSpaceContext("journal", "/vault/journal", { activate: false });
    expect(useContextStore.getState().contexts[0]!.id).toBe(old.id);

    const moved = await useContextStore
      .getState()
      .ensureSpaceContext("journal", "/elsewhere/journal", { activate: false });

    // `addContext` appended the new directory behind the plain vault and saw
    // the old context still in front, so it pinned nothing; the retire must,
    // or the Journal tab lands at the end and stays there (order persists).
    const ids = useContextStore.getState().contexts.map((c) => c.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(moved.id);
  });

  it("refuses to move the space onto a directory that is already another context", async () => {
    const plain = await useContextStore
      .getState()
      .addContext("vault", "/vault/notes");
    const journal = await useContextStore
      .getState()
      .ensureSpaceContext("journal", "/vault/journal", { activate: false });
    // The backend dedups by canonical path across every context: registering
    // the journal at /vault/notes answers with the plain vault.
    ipcAddContext.mockImplementationOnce(async () => plain);

    const refusal = useContextStore
      .getState()
      .ensureSpaceContext("journal", "/vault/notes");
    await expect(refusal).rejects.toThrow(
      /already registered as another context/,
    );
    // Typed, so a caller with a locale can phrase it for the user.
    await expect(refusal).rejects.toBeInstanceOf(SpaceDirectoryTakenError);
    await expect(refusal).rejects.toMatchObject({
      dir: "/vault/notes",
      takenBy: expect.objectContaining({ id: plain.id }),
      vaultType: "journal",
    });

    const { contexts } = useContextStore.getState();
    expect(contexts.find((c) => c.id === journal.id)?.path).toBe(
      "/vault/journal",
    );
    expect(contexts.find((c) => c.id === plain.id)?.vaultType).toBeUndefined();
    expect(ipcRemoveContext).not.toHaveBeenCalled();
    expect(switchContext).not.toHaveBeenCalled();
  });

  it("refuses the FIRST space context too when its directory is already another context", async () => {
    const plain = await useContextStore
      .getState()
      .addContext("vault", "/vault/notes");
    // No journal context yet; the backend dedups the journal directory onto
    // the open vault. Taking that as the journal would leave the space with
    // no context of its type while the caller believes it has one.
    ipcAddContext.mockImplementationOnce(async () => plain);

    await expect(
      useContextStore.getState().ensureSpaceContext("journal", "/vault/notes"),
    ).rejects.toBeInstanceOf(SpaceDirectoryTakenError);

    const { activeContextId, contexts } = useContextStore.getState();
    expect(contexts.map((c) => c.id)).toEqual([plain.id]);
    expect(contexts[0]!.vaultType).toBeUndefined();
    expect(activeContextId).toBe(plain.id);
    expect(ipcRemoveContext).not.toHaveBeenCalled();
    expect(switchContext).not.toHaveBeenCalled();
  });

  it("refuses the first space context when its directory is the OTHER space", async () => {
    const zettel = await useContextStore
      .getState()
      .ensureSpaceContext("zettelkasten", "/vault/zk", { activate: false });
    ipcAddContext.mockImplementationOnce(async () => zettel);

    await expect(
      useContextStore.getState().ensureSpaceContext("journal", "/vault/zk"),
    ).rejects.toMatchObject({
      takenBy: expect.objectContaining({ id: zettel.id }),
    });

    expect(useContextStore.getState().contexts.map((c) => c.id)).toEqual([
      zettel.id,
    ]);
    expect(useContextStore.getState().spaceContext("journal")).toBeNull();
  });

  it("leaves no trace of a context the backend answered with but the store never held", async () => {
    const journal = await useContextStore
      .getState()
      .ensureSpaceContext("journal", "/vault/journal", { activate: false });
    // Rust still holds a legacy folder root at the new directory — an entry
    // this store dropped long ago — and answers the dedup with it.
    ipcAddContext.mockImplementationOnce(async () => ({
      addedAt: 0,
      color: "#000",
      contextType: "folder",
      id: "legacy-1",
      label: "notes",
      path: "/vault/notes",
    }));

    await expect(
      useContextStore.getState().ensureSpaceContext("journal", "/vault/notes"),
    ).rejects.toBeInstanceOf(SpaceDirectoryTakenError);

    // The refused setting appended nothing; Rust's entry was not this call's
    // to remove.
    expect(useContextStore.getState().contexts.map((c) => c.id)).toEqual([
      journal.id,
    ]);
    expect(ipcRemoveContext).not.toHaveBeenCalled();
  });

  it("puts the active seat back when the refused directory was the store's first context", async () => {
    // The store is EMPTY — every other refusal test starts with a context, so
    // none of them arms `_addContextTracked`'s auto-activation. Rust still
    // holds a legacy entry at the directory (a `removeContext` whose Rust half
    // failed and was swallowed) and answers the dedup with it.
    ipcAddContext.mockImplementationOnce(async () => ({
      addedAt: 0,
      color: "#000",
      contextType: "folder",
      id: "legacy-1",
      label: "notes",
      path: "/vault/notes",
    }));

    await expect(
      useContextStore.getState().ensureSpaceContext("journal", "/vault/notes"),
    ).rejects.toBeInstanceOf(SpaceDirectoryTakenError);

    const { activeContextId, contexts } = useContextStore.getState();
    expect(contexts).toEqual([]);
    // Not just the list: an id left here names a context the store no longer
    // holds, and the `activeContextId === null` gate would never auto-activate
    // again — the next openFolder would register a vault nothing activates.
    expect(activeContextId).toBeNull();

    // Proof that the gate still works: the next add takes the seat.
    const next = await useContextStore
      .getState()
      .addContext("vault", "/vault/notes2");
    expect(useContextStore.getState().activeContextId).toBe(next.id);
  });

  it("does not retire anything when the backend says the new spelling is the same directory", async () => {
    const old = await useContextStore
      .getState()
      .ensureSpaceContext("journal", "/vault/journal");
    // The backend dedups by canonical path and answers with the context we hold.
    ipcAddContext.mockImplementationOnce(async () => old);
    const same = await useContextStore
      .getState()
      .ensureSpaceContext("journal", "/vault/JOURNAL");
    expect(same.id).toBe(old.id);
    expect(ipcRemoveContext).not.toHaveBeenCalled();
    expect(useContextStore.getState().contexts).toHaveLength(1);
  });
});
