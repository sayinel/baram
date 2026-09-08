// issue 263 — the backend now refuses a rename it cannot complete (the link
// index for the vault is still being built, or the file is outside every
// registered context) instead of renaming and leaving references stale. That
// refusal used to reach only the log; the tree just kept the old name. It
// must reach the user as a toast, and nothing local may pretend the rename
// happened.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../ipc/invoke")>()),
  readFile: vi.fn(async () => ""),
  refreshIndex: vi.fn(async () => ({ fileCount: 0, linkCount: 0 })),
  renameFileWithLinks: vi.fn(),
  renameNamespace: vi.fn(),
}));

import {
  refreshIndex,
  renameFileWithLinks,
  renameNamespace,
} from "../../../../ipc/invoke";
import { useEditorStore } from "../../../../stores/editor/editor";
import { useFileStore } from "../../../../stores/file/file";
import { useUIStore } from "../../../../stores/ui/ui";
import { useFileTreeRename } from "../use-file-tree-rename";

const NOT_READY =
  "The link index for this vault is still being built. Try again in a moment.";

const renameFileEntry = vi.fn();
const renameTab = vi.fn();
const renameDirInTabs = vi.fn();
const showToast = vi.fn();

beforeEach(() => {
  vi.mocked(renameFileWithLinks).mockReset();
  vi.mocked(renameNamespace).mockReset();
  vi.mocked(refreshIndex).mockClear();
  // ‼️ mockReset, not mockClear — the local-update case below installs a
  // THROWING implementation on `renameTab`, and mockClear would leave it in
  // place for whatever runs next.
  renameFileEntry.mockReset();
  renameTab.mockReset();
  showToast.mockReset();
  useFileStore.setState({
    fileTree: [
      { isDir: false, name: "b.md", path: "/vault/b.md" },
      { children: [], isDir: true, name: "ns", path: "/vault/ns" },
    ],
    renameFileEntry,
    rootPath: "/vault",
  });
  useEditorStore.setState({ renameDirInTabs, renameTab });
  useUIStore.setState({ showToast });
});

function rename(): Promise<void> {
  const { result } = renderHook(() => useFileTreeRename({ current: null }));
  return act(() => result.current.handleConfirmRename("/vault/b.md", "c.md"));
}

describe("a refused rename reaches the user (issue 263)", () => {
  it("shows the backend's reason as an error toast and leaves the tree alone", async () => {
    vi.mocked(renameFileWithLinks).mockRejectedValue(NOT_READY);
    await rename();

    expect(showToast).toHaveBeenCalledTimes(1);
    const [message, type] = showToast.mock.calls[0]!;
    expect(message).toContain(NOT_READY);
    expect(type).toBe("error");
    expect(renameFileEntry).not.toHaveBeenCalled();
    expect(renameTab).not.toHaveBeenCalled();
  });

  it("CONTROL: a completed rename updates the tree and tabs without a toast", async () => {
    vi.mocked(renameFileWithLinks).mockResolvedValue({
      skippedFiles: [],
      updatedFiles: [],
    });
    await rename();

    expect(renameFileEntry).toHaveBeenCalledWith(
      "/vault/b.md",
      "/vault/c.md",
      "c.md",
    );
    expect(renameTab).toHaveBeenCalledWith(
      "/vault/b.md",
      "/vault/c.md",
      "c.md",
    );
    expect(showToast).not.toHaveBeenCalled();
  });

  // The other half of the same rule: once the IPC call has returned, the file
  // IS renamed on disk. The try used to cover the local store updates too, so
  // any throw from them showed "Rename failed" — the opposite of what
  // happened, and the user has no way to tell which story is true.
  it("does not toast a failure when a local update throws after a completed rename", async () => {
    vi.mocked(renameFileWithLinks).mockResolvedValue({
      skippedFiles: [],
      updatedFiles: [],
    });
    renameTab.mockImplementation(() => {
      throw new Error("subscriber blew up");
    });

    await rename();

    expect(renameFileEntry).toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });
});

// issue 594 — the other kind of bad news. Once the IPC call has returned the
// rename is done, but the result may say that a referring file could not be
// rewritten, or (for a directory) that the link index was not rebuilt. Those
// are not `Err`s — nothing about the move is undone — so they reach the user
// as warnings, and the local tree/tab updates happen regardless.
describe("post-commit outcomes reach the user as warnings (issue 594)", () => {
  it("warns about referring files the backend could not rewrite, after updating the tree", async () => {
    vi.mocked(renameFileWithLinks).mockResolvedValue({
      skippedFiles: ["/vault/ro/ref.md", "/vault/ro/other.md"],
      updatedFiles: ["/vault/a.md"],
    });
    await rename();

    expect(renameFileEntry).toHaveBeenCalledWith(
      "/vault/b.md",
      "/vault/c.md",
      "c.md",
    );
    expect(showToast).toHaveBeenCalledTimes(1);
    const [message, type] = showToast.mock.calls[0]!;
    expect(message).toContain("2");
    expect(type).toBe("warning");
    // A file rename has no index to rebuild.
    expect(refreshIndex).not.toHaveBeenCalled();
  });

  it("warns that a directory's index was not rebuilt and asks for one rebuild", async () => {
    vi.mocked(renameNamespace).mockResolvedValue({
      filesMoved: 3,
      indexRebuilt: false,
      skippedFiles: [],
      uncheckedFiles: [],
      updatedFiles: [],
    });
    const { result } = renderHook(() => useFileTreeRename({ current: null }));
    await act(() => result.current.handleConfirmRename("/vault/ns", "ns2"));

    expect(renameNamespace).toHaveBeenCalledWith(
      "/vault/ns",
      "/vault/ns2",
      "/vault",
    );
    expect(renameDirInTabs).toHaveBeenCalledWith("/vault/ns", "/vault/ns2");
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0]![1]).toBe("warning");
    expect(refreshIndex).toHaveBeenCalledTimes(1);
    expect(refreshIndex).toHaveBeenCalledWith("/vault");
  });

  it("folds every post-commit outcome into ONE warning — the UI store shows a single toast", async () => {
    // Two `showToast` calls in a row would leave only the second visible, so
    // the user would never hear that references remain stale.
    vi.mocked(renameNamespace).mockResolvedValue({
      filesMoved: 3,
      indexRebuilt: false,
      skippedFiles: ["/vault/ro/a.md"],
      uncheckedFiles: ["/vault/locked.md", "/vault/locked2.md"],
      updatedFiles: [],
    });
    const { result } = renderHook(() => useFileTreeRename({ current: null }));
    await act(() => result.current.handleConfirmRename("/vault/ns", "ns2"));

    expect(showToast).toHaveBeenCalledTimes(1);
    const [message, type] = showToast.mock.calls[0]!;
    expect(type).toBe("warning");
    // One sentence per outcome: the failed referrer, the two unreadable
    // files, the index.
    expect(message).toContain("1 file");
    expect(message).toContain("2 file");
    expect(message).toContain("link index");
    expect(refreshIndex).toHaveBeenCalledTimes(1);
  });

  it("says so when a referrer with unsaved changes could not be brought in line on screen", async () => {
    vi.mocked(renameFileWithLinks).mockResolvedValue({
      skippedFiles: [],
      updatedFiles: ["/vault/a.md"],
    });
    // a.md is open and dirty: its links changed on disk, not on screen.
    useFileStore.setState({
      openFiles: new Map([["/vault/a.md", "see [[b]]"]]),
    } as never);
    useEditorStore.setState({
      activeTabId: "t2",
      tabs: [
        { filePath: "/vault/a.md", id: "t2", isDirty: true, type: "file" },
      ],
    } as never);
    await rename();

    expect(showToast).toHaveBeenCalledTimes(1);
    const [message, type] = showToast.mock.calls[0]!;
    expect(type).toBe("warning");
    expect(message).toContain("unsaved");
  });

  it("CONTROL: a directory rename whose index was rebuilt toasts nothing and rebuilds nothing", async () => {
    vi.mocked(renameNamespace).mockResolvedValue({
      filesMoved: 3,
      indexRebuilt: true,
      skippedFiles: [],
      uncheckedFiles: [],
      updatedFiles: [],
    });
    const { result } = renderHook(() => useFileTreeRename({ current: null }));
    await act(() => result.current.handleConfirmRename("/vault/ns", "ns2"));

    expect(showToast).not.toHaveBeenCalled();
    expect(refreshIndex).not.toHaveBeenCalled();
  });

  it("a refused rebuild after the warning is logged, not toasted", async () => {
    vi.mocked(renameNamespace).mockResolvedValue({
      filesMoved: 1,
      indexRebuilt: false,
      skippedFiles: [],
      uncheckedFiles: [],
      updatedFiles: [],
    });
    vi.mocked(refreshIndex).mockRejectedValueOnce("/vault is not registered");
    const { result } = renderHook(() => useFileTreeRename({ current: null }));
    await act(() => result.current.handleConfirmRename("/vault/ns", "ns2"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0]![1]).toBe("warning");
  });
});
