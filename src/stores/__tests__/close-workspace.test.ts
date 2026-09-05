// §81 File → Close Workspace must always land on the home screen.
//
// ‼️ The bug this pins: `closeFolder()` cleared `rootPath` and then removed the
// contexts ONE AT A TIME without awaiting. Each removal of the *active* context
// handed `activeContextId` down to the next survivor, and file.ts's cross-store
// subscription turns every such hand-off into `setRootPath(ctx.path)` — putting
// back the very `rootPath` that was just cleared. The last removal sets the id to
// null, where the subscription early-returns, so nothing ever cleared it again.
//
// The user-visible split: `resolveSurfaceKind` reads `rootPath ? "empty" : "home"`,
// so the same menu item showed the home screen or the "pick a file" empty-workspace
// message depending on WHERE the active context sat in the list.
import type { EditorTab } from "../editor/editor";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { requestCloseWorkspace } from "../../hooks/use-close-guard";
import { resolveSurfaceKind } from "../../utils/editor/surface-kind";
import { useContextStore } from "../context/context";
import { useEditorStore } from "../editor/editor";
import { useFileStore } from "../file/file";
import { useUIStore } from "../ui/ui";

// ‼️ `removeContext` lives in `ipc/context`, NOT `ipc/invoke`. Mocking the wrong
// module leaves the real Tauri call in place, where `.catch(() => {})` swallows its
// failure — the store still empties, so every assertion but the call-count one
// passes and the double silently proves nothing.
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

function ctx(id: string, path: string) {
  return {
    id,
    addedAt: 0,
    color: "#ffffff",
    contextType: "vault" as const,
    label: id,
    path,
  };
}

/** Let every fired-and-forgotten `removeContext` promise settle. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** What the editor area would render right now, with no tab open. */
function surface(): string {
  return resolveSurfaceKind({
    activeTabId: null,
    fileViewers: [],
    isHtmlSourceView: false,
    isSourceMode: false,
    rootPath: useFileStore.getState().rootPath,
    tab: undefined,
  });
}

describe("closeFolder — clears the whole workspace, deterministically", () => {
  beforeEach(() => {
    useEditorStore.setState({ activeTabId: null, tabs: [] } as never);
  });

  // The order that used to fail: active context first, two survivors to inherit it.
  it("lands on the home screen when the ACTIVE context is not the last one", async () => {
    useContextStore.setState({
      activeContextId: "a",
      contexts: [
        ctx("a", "/vault/a"),
        ctx("b", "/vault/b"),
        ctx("c", "/vault/c"),
      ],
    } as never);
    useFileStore.setState({ rootPath: "/vault/a" } as never);

    useFileStore.getState().closeFolder();
    await settle();

    expect(useFileStore.getState().rootPath).toBeNull();
    expect(surface()).toBe("home");
  });

  // The order that used to pass by luck — pinned so a fix cannot trade one for the other.
  it("lands on the home screen when the ACTIVE context is the last one", async () => {
    useContextStore.setState({
      activeContextId: "c",
      contexts: [
        ctx("a", "/vault/a"),
        ctx("b", "/vault/b"),
        ctx("c", "/vault/c"),
      ],
    } as never);
    useFileStore.setState({ rootPath: "/vault/c" } as never);

    useFileStore.getState().closeFolder();
    await settle();

    expect(useFileStore.getState().rootPath).toBeNull();
    expect(surface()).toBe("home");
  });

  it("removes every context and leaves no active one", async () => {
    useContextStore.setState({
      activeContextId: "a",
      contexts: [
        ctx("a", "/vault/a"),
        ctx("b", "/vault/b"),
        ctx("c", "/vault/c"),
      ],
    } as never);
    useFileStore.setState({ rootPath: "/vault/a" } as never);

    useFileStore.getState().closeFolder();
    await settle();

    expect(useContextStore.getState().contexts).toEqual([]);
    expect(useContextStore.getState().activeContextId).toBeNull();
  });

  // The ContextTabBar / VaultTab paths reach `closeFolder()` only AFTER the last
  // context is already gone, so the store is empty by the time it runs. Without the
  // equality gate that is a `set` publishing a fresh `[]`/`null` root, waking every
  // `useContextStore` selector for a state that did not change.
  it("does nothing when the workspace is already empty", async () => {
    const { removeContext } = await import("../../ipc/context");
    vi.mocked(removeContext).mockClear();
    useContextStore.setState({ activeContextId: null, contexts: [] } as never);
    useFileStore.setState({ rootPath: null } as never);
    const before = useContextStore.getState().contexts;

    useFileStore.getState().closeFolder();
    await settle();

    expect(vi.mocked(removeContext)).not.toHaveBeenCalled();
    // Same array identity — proof no `set` ran, which a `toEqual([])` would miss.
    expect(useContextStore.getState().contexts).toBe(before);
  });

  it("tells Rust to drop every context, not just the ones it got around to", async () => {
    const { removeContext } = await import("../../ipc/context");
    vi.mocked(removeContext).mockClear();
    useContextStore.setState({
      activeContextId: "a",
      contexts: [
        ctx("a", "/vault/a"),
        ctx("b", "/vault/b"),
        ctx("c", "/vault/c"),
      ],
    } as never);
    useFileStore.setState({ rootPath: "/vault/a" } as never);

    useFileStore.getState().closeFolder();
    await settle();

    expect(
      vi
        .mocked(removeContext)
        .mock.calls.map((c) => c[0])
        .sort(),
    ).toEqual(["a", "b", "c"]);
  });
});

// §81 The guard in front of the menu item. Before it existed, `closeAllTabs()`
// threw unsaved tabs away with no prompt at all — the design spec
// (dev/design/specs/2026-03-11-home-screen-design.md) asked for the confirmation
// from the start and never got one.
describe("requestCloseWorkspace — asks before discarding unsaved work", () => {
  function tab(id: string, over: Partial<EditorTab> = {}): EditorTab {
    return {
      contextId: "a",
      filePath: `/vault/a/${id}.md`,
      id,
      isDirty: false,
      isPinned: false,
      title: `${id}.md`,
      type: "file",
      ...over,
    };
  }

  beforeEach(() => {
    useUIStore.setState({ unsavedModal: null });
    useContextStore.setState({
      activeContextId: "a",
      contexts: [ctx("a", "/vault/a")],
    } as never);
    useFileStore.setState({ rootPath: "/vault/a" } as never);
  });

  it("closes immediately when nothing is dirty", () => {
    useEditorStore.setState({
      activeTabId: null,
      tabs: [tab("clean")],
    } as never);

    requestCloseWorkspace();

    expect(useFileStore.getState().rootPath).toBeNull();
    expect(useUIStore.getState().unsavedModal).toBeNull();
  });

  it("prompts and leaves the workspace ALONE when a tab is dirty", () => {
    useEditorStore.setState({
      activeTabId: "d",
      tabs: [tab("clean"), tab("d", { isDirty: true })],
    } as never);

    requestCloseWorkspace();

    // The discriminating half: a prompt that fires while the workspace is already
    // gone would be theatre. Nothing may be closed until the user answers.
    expect(useFileStore.getState().rootPath).toBe("/vault/a");
    expect(useContextStore.getState().contexts).toHaveLength(1);
    expect(useUIStore.getState().unsavedModal).toEqual({
      intent: "closeWorkspace",
    });
  });

  it("ignores a dirty non-file tab — there is nothing on disk to save", () => {
    useEditorStore.setState({
      activeTabId: "g",
      tabs: [tab("g", { filePath: "", isDirty: true, type: "graph" })],
    } as never);

    requestCloseWorkspace();

    expect(useFileStore.getState().rootPath).toBeNull();
    expect(useUIStore.getState().unsavedModal).toBeNull();
  });
});
