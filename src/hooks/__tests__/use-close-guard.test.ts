// §close-guard: unit tests for the unsaved-changes quit/close guard helpers.
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../ipc/invoke", () => ({
  confirmQuit: vi.fn().mockResolvedValue(undefined),
  updateFileIndex: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));

import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";

import type { EditorTab } from "../../stores/editor/editor";
import type { CloseGuardDeps } from "../use-close-guard";

import { confirmQuit, writeFile } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useUIStore } from "../../stores/ui/ui";
import {
  saveAllDirtyForQuit,
  saveDirtyTab,
  useCloseGuard,
} from "../use-close-guard";

// ── helpers ────────────────────────────────────────────────────────────────

/** Grab the callback registered by useCloseGuard for the close/quit event. */
function closeRequestedHandler(): () => void {
  const call = vi
    .mocked(listen)
    .mock.calls.find((c) => c[0] === "app://close-requested");
  if (!call) throw new Error("app://close-requested listener not registered");
  return call[1] as unknown as () => void;
}

function fileTab(over: Partial<EditorTab> = {}): EditorTab {
  return {
    contextId: "ctx",
    filePath: "/vault/a.md",
    id: "t1",
    isDirty: true,
    isPinned: false,
    title: "a.md",
    type: "file",
    ...over,
  };
}

function makeDeps(handleSave: () => Promise<void>): CloseGuardDeps {
  return {
    editor: null,
    handleSave,
    isSourceMode: false,
    sourceContentRef: { current: "" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({ activeTabId: null, mruOrder: [], tabs: [] });
  useFileStore.setState({ openFiles: new Map() });
  useUIStore.setState({ unsavedModal: null });
});

// ── saveDirtyTab ─────────────────────────────────────────────────────────────

describe("saveDirtyTab", () => {
  it("active tab → flushes via handleSave and returns true when it becomes clean", async () => {
    const tab = fileTab({ id: "active" });
    useEditorStore.setState({ activeTabId: "active", tabs: [tab] });
    const handleSave = vi.fn(async () => {
      useEditorStore.getState().markDirty("active", false);
    });

    const ok = await saveDirtyTab(tab, "active", handleSave);

    expect(handleSave).toHaveBeenCalledOnce();
    expect(ok).toBe(true);
  });

  it("active tab → returns false when it stays dirty (Save As cancelled)", async () => {
    const tab = fileTab({ id: "active" });
    useEditorStore.setState({ activeTabId: "active", tabs: [tab] });
    // handleSave that does NOT clear dirty simulates a cancelled Save As.
    const handleSave = vi.fn(async () => {});

    const ok = await saveDirtyTab(tab, "active", handleSave);

    expect(ok).toBe(false);
  });

  it("non-active file tab → writes cached content and clears its dirty flag", async () => {
    const tab = fileTab({ filePath: "/vault/bg.md", id: "bg" });
    useEditorStore.setState({ activeTabId: "other", tabs: [tab] });
    useFileStore.setState({
      openFiles: new Map([["/vault/bg.md", "# hello"]]),
    });

    const ok = await saveDirtyTab(tab, "other", vi.fn());

    expect(writeFile).toHaveBeenCalledWith("/vault/bg.md", "# hello");
    expect(ok).toBe(true);
    expect(
      useEditorStore.getState().tabs.find((t) => t.id === "bg")?.isDirty,
    ).toBe(false);
  });

  it("non-active Untitled tab → prompts Save As, writes to the chosen path, and rewrites the tab", async () => {
    const tab = fileTab({ filePath: "", id: "untitled-1", title: "Untitled" });
    useEditorStore.setState({ activeTabId: "other", tabs: [tab] });
    useFileStore.setState({
      openFiles: new Map([["untitled-1", "draft body"]]),
    });
    vi.mocked(save).mockResolvedValue("/vault/new.md");

    const ok = await saveDirtyTab(tab, "other", vi.fn());

    expect(save).toHaveBeenCalledOnce();
    expect(writeFile).toHaveBeenCalledWith("/vault/new.md", "draft body");
    expect(ok).toBe(true);
    const updated = useEditorStore
      .getState()
      .tabs.find((t) => t.id === "untitled-1");
    expect(updated?.filePath).toBe("/vault/new.md");
    expect(updated?.isDirty).toBe(false);
    expect(updated?.title).toBe("new.md");
  });

  it("non-active Untitled tab → returns false and writes nothing when Save As is cancelled", async () => {
    const tab = fileTab({ filePath: "", id: "u2", title: "Untitled" });
    useEditorStore.setState({ activeTabId: "other", tabs: [tab] });
    vi.mocked(save).mockResolvedValue(null);

    const ok = await saveDirtyTab(tab, "other", vi.fn());

    expect(ok).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });
});

// ── saveAllDirtyForQuit ──────────────────────────────────────────────────────

describe("saveAllDirtyForQuit", () => {
  it("saves the active tab first, then the remaining dirty tabs, and returns true", async () => {
    const active = fileTab({
      filePath: "/v/active.md",
      id: "active",
      title: "active.md",
    });
    const bg = fileTab({ filePath: "/v/bg.md", id: "bg", title: "bg.md" });
    useEditorStore.setState({ activeTabId: "active", tabs: [bg, active] });
    useFileStore.setState({ openFiles: new Map([["/v/bg.md", "bg content"]]) });
    const handleSave = vi.fn(async () => {
      useEditorStore.getState().markDirty("active", false);
    });

    const ok = await saveAllDirtyForQuit(makeDeps(handleSave));

    expect(ok).toBe(true);
    expect(handleSave).toHaveBeenCalledOnce();
    expect(writeFile).toHaveBeenCalledWith("/v/bg.md", "bg content");
    // Active tab is flushed before the background tab is written.
    expect(handleSave.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(writeFile).mock.invocationCallOrder[0],
    );
  });

  it("returns false and skips remaining tabs when the active tab's Save As is cancelled", async () => {
    const active = fileTab({ filePath: "", id: "active", title: "Untitled" });
    const bg = fileTab({ filePath: "/v/bg.md", id: "bg", title: "bg.md" });
    useEditorStore.setState({ activeTabId: "active", tabs: [bg, active] });
    // Active Untitled tab stays dirty → saveDirtyTab returns false.
    const handleSave = vi.fn(async () => {});

    const ok = await saveAllDirtyForQuit(makeDeps(handleSave));

    expect(ok).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("ignores non-file tabs (e.g. graph) and clean tabs", async () => {
    const graph = fileTab({ id: "g", isDirty: true, type: "graph" });
    const clean = fileTab({
      filePath: "/v/clean.md",
      id: "clean",
      isDirty: false,
    });
    useEditorStore.setState({ activeTabId: null, tabs: [graph, clean] });

    const ok = await saveAllDirtyForQuit(makeDeps(vi.fn()));

    expect(ok).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });
});

// ── useCloseGuard ────────────────────────────────────────────────────────────

describe("useCloseGuard", () => {
  it("registers a listener for the app://close-requested event", () => {
    renderHook(() => useCloseGuard());

    expect(vi.mocked(listen)).toHaveBeenCalledWith(
      "app://close-requested",
      expect.any(Function),
    );
  });

  it("confirms the quit immediately when no file tab is dirty", async () => {
    useEditorStore.setState({
      activeTabId: "t1",
      tabs: [fileTab({ isDirty: false })],
    });
    renderHook(() => useCloseGuard());

    closeRequestedHandler()();

    await vi.waitFor(() => expect(confirmQuit).toHaveBeenCalledOnce());
    expect(useUIStore.getState().unsavedModal).toBeNull();
  });

  it("opens the unsaved-changes modal (intent quit) when a file tab is dirty", async () => {
    useEditorStore.setState({
      activeTabId: "t1",
      tabs: [fileTab({ isDirty: true })],
    });
    renderHook(() => useCloseGuard());

    closeRequestedHandler()();

    await vi.waitFor(() =>
      expect(useUIStore.getState().unsavedModal).toEqual({ intent: "quit" }),
    );
    expect(confirmQuit).not.toHaveBeenCalled();
  });
});
