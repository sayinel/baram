import type { EditorTab } from "../../stores/editor/editor";

// §82 Closing a context — the guard in front of it, and the shared close itself.
//
// ‼️ FOUR user-reachable paths closed a context and they had three implementations
// between them (tab x, its context menu's Close and Close Others, Settings > Vault's
// remove). None asked about unsaved work; two skipped the active/last-context
// handling and so could strand the app on the empty-workspace surface. These tests
// pin the shared behaviour they all route through now.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { requestCloseContexts } from "../../hooks/use-close-guard";
import { useContextStore } from "../../stores/context/context";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useWorkspaceStore } from "../../stores/file/workspace";
import { useUIStore } from "../../stores/ui/ui";
import { closeContext, closeContexts } from "../close-context";
import { switchContext } from "../vault-context-loader";

vi.mock("../../ipc/context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ipc/context")>();
  return { ...actual, removeContext: vi.fn(async () => undefined) };
});

vi.mock("../../ipc/invoke", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ipc/invoke")>();
  return {
    ...actual,
    listDir: vi.fn(async () => []),
    refreshIndex: vi.fn(async () => ({ fileCount: 0, linkCount: 0 })),
    setVaultRoot: vi.fn(async () => undefined),
  };
});

// `closeContext` hands off to `switchContext` when the closed context was active
// and a survivor remains. That is the loader's whole vault-load path (IPC, Rust
// registration); stub it so these tests answer only for the close itself.
vi.mock("../vault-context-loader", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../vault-context-loader")>();
  return { ...actual, switchContext: vi.fn(async () => undefined) };
});

function ctx(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    addedAt: 0,
    color: "#ffffff",
    contextType: "vault" as const,
    label: `label-${id}`,
    path: `/vault/${id}`,
    ...over,
  };
}

function tab(id: string, contextId: string, isDirty = false): EditorTab {
  return {
    contextId,
    filePath: `/vault/${contextId}/${id}.md`,
    id,
    isDirty,
    isPinned: false,
    title: `${id}.md`,
    type: "file",
  };
}

/** Two contexts, `a` active, one clean tab each. */
function twoContexts(tabs: EditorTab[]) {
  useContextStore.setState({
    activeContextId: "a",
    contexts: [ctx("a"), ctx("b")],
  } as never);
  useFileStore.setState({ rootPath: "/vault/a" } as never);
  useEditorStore.setState({ activeTabId: null, mruOrder: [], tabs } as never);
}

// One test swaps the store's `removeContext` for a throwing stub. zustand's setState
// MERGES, so that stub outlives the test unless it is put back — the next test then
// asserts against a mock that never reaches the IPC layer and reads as a real failure.
const realRemoveContext = useContextStore.getState().removeContext;

beforeEach(() => {
  useContextStore.setState({ removeContext: realRemoveContext } as never);
  vi.mocked(switchContext).mockClear();
  useUIStore.setState({ unsavedModal: null });
  useWorkspaceStore.setState({ activePresetId: null } as never);
});

describe("closeContext — one implementation for every close path", () => {
  it("closes the context's own editor tabs and leaves the others alone", async () => {
    twoContexts([tab("a1", "a"), tab("a2", "a"), tab("b1", "b")]);

    await closeContext("a");

    // The orphan this fixes: Settings > Vault used to remove the context and leave
    // these tabs pointing at an id nothing can resolve any more.
    expect(useEditorStore.getState().tabs.map((t) => t.id)).toEqual(["b1"]);
    expect(useContextStore.getState().contexts.map((c) => c.id)).toEqual(["b"]);
  });

  it("lands on the home screen when the LAST context is closed", async () => {
    useContextStore.setState({
      activeContextId: "a",
      contexts: [ctx("a")],
    } as never);
    useFileStore.setState({ rootPath: "/vault/a" } as never);
    useEditorStore.setState({
      activeTabId: null,
      mruOrder: [],
      tabs: [tab("a1", "a")],
    } as never);

    await closeContext("a");
    await new Promise((r) => setTimeout(r, 0));

    // The context menu's Close skipped this entirely and left rootPath set, which
    // is the empty-workspace surface §81 fixed on the File-menu path.
    expect(useFileStore.getState().rootPath).toBeNull();
  });
});

describe("requestCloseContexts — asks before discarding, scoped to those contexts", () => {
  it("closes straight away when nothing in that context is dirty", async () => {
    twoContexts([tab("a1", "a"), tab("b1", "b", true)]);

    await requestCloseContexts(["a"]);

    // Discriminating: `b` IS dirty. A guard that forgot to scope would prompt here.
    expect(useUIStore.getState().unsavedModal).toBeNull();
    expect(useContextStore.getState().contexts.map((c) => c.id)).toEqual(["b"]);
  });

  it("prompts and closes NOTHING while it waits", async () => {
    twoContexts([tab("a1", "a", true), tab("b1", "b")]);

    await requestCloseContexts(["a"]);

    expect(useUIStore.getState().unsavedModal).toEqual({
      contextIds: ["a"],
      intent: "closeContext",
    });
    // Once the context is gone, Cancel has nothing to put back — so nothing may
    // move until the user answers.
    expect(useContextStore.getState().contexts.map((c) => c.id)).toEqual([
      "a",
      "b",
    ]);
    expect(useEditorStore.getState().tabs.map((t) => t.id)).toEqual([
      "a1",
      "b1",
    ]);
  });

  it("Close Others asks ONCE, carrying every context it is about to close", async () => {
    useContextStore.setState({
      activeContextId: "a",
      contexts: [ctx("a"), ctx("b"), ctx("c")],
    } as never);
    useFileStore.setState({ rootPath: "/vault/a" } as never);
    useEditorStore.setState({
      activeTabId: null,
      mruOrder: [],
      tabs: [tab("b1", "b", true), tab("c1", "c", true)],
    } as never);

    await requestCloseContexts(["b", "c"]);

    expect(useUIStore.getState().unsavedModal).toEqual({
      contextIds: ["b", "c"],
      intent: "closeContext",
    });
  });

  it("does nothing at all for an empty list", async () => {
    twoContexts([tab("a1", "a", true)]);

    await requestCloseContexts([]);

    expect(useUIStore.getState().unsavedModal).toBeNull();
    expect(useContextStore.getState().contexts).toHaveLength(2);
  });
});

describe("closeContexts — ordering, tolerance, and the states it must NOT pass through", () => {
  it("closes a NON-active context without switching anything", async () => {
    twoContexts([tab("a1", "a"), tab("b1", "b")]);

    await closeContext("b");

    // The false branch of `closingActive`. Every other test here closes the active
    // context, so without this one `const closingActive = true` survives.
    expect(switchContext).not.toHaveBeenCalled();
    expect(useContextStore.getState().activeContextId).toBe("a");
    expect(useFileStore.getState().rootPath).toBe("/vault/a");
  });

  it("switches ONCE, to the final survivor — never into a context it is closing", async () => {
    useContextStore.setState({
      activeContextId: "a",
      contexts: [ctx("a"), ctx("b"), ctx("c"), ctx("d")],
    } as never);
    useFileStore.setState({ rootPath: "/vault/a" } as never);
    useEditorStore.setState({ activeTabId: null, mruOrder: [], tabs: [] });

    await closeContexts(["a", "b", "c"]);

    // A per-context loop would hand the active id to b, then c, and load each —
    // a full vault load plus §334's approval dialog for folders being closed one
    // line later. Exactly one switch, and only to the context that survives.
    expect(switchContext).toHaveBeenCalledOnce();
    expect(switchContext).toHaveBeenCalledWith("d");
    expect(useContextStore.getState().contexts.map((c) => c.id)).toEqual(["d"]);
  });

  it("closes PINNED tabs too — the context they name is going away", async () => {
    twoContexts([tab("a1", "a"), { ...tab("a2", "a"), isPinned: true }]);

    await closeContext("a");

    // `closeTab` refuses pinned tabs (§38). Left behind, this one would name a
    // context that no longer exists — the orphan this module exists to prevent.
    expect(useEditorStore.getState().tabs).toEqual([]);
  });

  it("reverts the space when the closed context backed it", async () => {
    useContextStore.setState({
      activeContextId: "j",
      contexts: [ctx("j", { vaultType: "journal" }), ctx("b")],
    } as never);
    useFileStore.setState({ rootPath: "/vault/j" } as never);
    useEditorStore.setState({ activeTabId: null, mruOrder: [], tabs: [] });
    useWorkspaceStore.setState({ activePresetId: "journal" } as never);

    await closeContext("j");

    // Reading vaultType AFTER the removal would silently yield undefined here.
    expect(useWorkspaceStore.getState().activePresetId).toBe("writing");
  });

  it("keeps closing the rest when one removal throws", async () => {
    useContextStore.setState({
      activeContextId: "d",
      contexts: [ctx("a"), ctx("b"), ctx("c"), ctx("d")],
      removeContext: vi.fn(async (id: string) => {
        if (id === "b") throw new Error("backend said no");
        useContextStore.setState((st) => ({
          contexts: st.contexts.filter((c) => c.id !== id),
        }));
      }),
    } as never);
    useEditorStore.setState({ activeTabId: null, mruOrder: [], tabs: [] });

    await closeContexts(["a", "b", "c"]);

    // Their tabs are already gone by then, so aborting on the first failure would
    // leave the user with half-closed folders and no way back.
    expect(useContextStore.getState().contexts.map((c) => c.id)).toEqual([
      "b",
      "d",
    ]);
  });

  it("ignores ids that no longer exist instead of spending a removal on them", async () => {
    const { removeContext } = await import("../../ipc/context");
    vi.mocked(removeContext).mockClear();
    twoContexts([]);

    await closeContexts(["ghost", "a"]);

    expect(vi.mocked(removeContext).mock.calls.map((c) => c[0])).toEqual(["a"]);
    expect(useContextStore.getState().contexts.map((c) => c.id)).toEqual(["b"]);
  });
});
