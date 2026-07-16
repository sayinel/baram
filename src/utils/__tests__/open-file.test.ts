import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readFile } from "../../ipc/fs";
import { notifyFileOpen } from "../../plugins/plugin-lifecycle";
import { useContextStore } from "../../stores/context/context";
import { useEditorStore } from "../../stores/editor/editor";
import { useSettingsStore } from "../../stores/settings/store";
import { openFileByPath } from "../open-file";

vi.mock("../../ipc/fs", () => ({ readFile: vi.fn() }));
vi.mock("../../plugins/plugin-lifecycle", () => ({ notifyFileOpen: vi.fn() }));

const mockReadFile = vi.mocked(readFile);

beforeEach(() => {
  useEditorStore.setState({ tabs: [], activeTabId: null });
  useSettingsStore.setState({ recentFiles: [] });
  useContextStore.setState({
    // stub context resolution so we don't touch IPC
    ensureFileContext: vi.fn(async () => ({ id: "ctx1" })),
  } as never);
});

afterEach(() => vi.clearAllMocks());

describe("openFileByPath", () => {
  it("opens a tab and records the file in recents", async () => {
    mockReadFile.mockResolvedValue("# hello");
    await openFileByPath("/vault/note.md");

    const { tabs } = useEditorStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({
      filePath: "/vault/note.md",
      title: "note.md",
    });
    expect(useSettingsStore.getState().recentFiles[0].path).toBe(
      "/vault/note.md",
    );
  });

  it("does NOT notify plugins of file:open — the tab-switch effect emits it once content loads", async () => {
    mockReadFile.mockResolvedValue("# hello");
    await openFileByPath("/vault/note.md");

    expect(notifyFileOpen).not.toHaveBeenCalled();
  });

  it("throws when reading the file fails (stale path)", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    await expect(openFileByPath("/gone/x.md")).rejects.toThrow();
  });

  it("activates an already-open tab instead of opening a duplicate", async () => {
    useEditorStore.getState().openTab({
      contextId: "c",
      id: "t1",
      filePath: "/vault/note.md",
      title: "note.md",
      isDirty: false,
      isPinned: false,
    });
    await openFileByPath("/vault/note.md");
    expect(useEditorStore.getState().tabs).toHaveLength(1);
    expect(useEditorStore.getState().activeTabId).toBe("t1");
    expect(mockReadFile).not.toHaveBeenCalled();
  });
});
