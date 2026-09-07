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
  renameFileWithLinks: vi.fn(),
  renameNamespace: vi.fn(),
}));

import { renameFileWithLinks } from "../../../../ipc/invoke";
import { useEditorStore } from "../../../../stores/editor/editor";
import { useFileStore } from "../../../../stores/file/file";
import { useUIStore } from "../../../../stores/ui/ui";
import { useFileTreeRename } from "../use-file-tree-rename";

const NOT_READY =
  "The link index for this vault is still being built. Try again in a moment.";

const renameFileEntry = vi.fn();
const renameTab = vi.fn();
const showToast = vi.fn();

beforeEach(() => {
  vi.mocked(renameFileWithLinks).mockReset();
  // ‼️ mockReset, not mockClear — the local-update case below installs a
  // THROWING implementation on `renameTab`, and mockClear would leave it in
  // place for whatever runs next.
  renameFileEntry.mockReset();
  renameTab.mockReset();
  showToast.mockReset();
  useFileStore.setState({
    fileTree: [{ isDir: false, name: "b.md", path: "/vault/b.md" }],
    renameFileEntry,
    rootPath: "/vault",
  });
  useEditorStore.setState({ renameTab });
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
    vi.mocked(renameFileWithLinks).mockResolvedValue({ updatedFiles: [] });
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
    vi.mocked(renameFileWithLinks).mockResolvedValue({ updatedFiles: [] });
    renameTab.mockImplementation(() => {
      throw new Error("subscriber blew up");
    });

    await rename();

    expect(renameFileEntry).toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });
});
