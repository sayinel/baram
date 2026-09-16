// issue 595 — the tree's paths are joined with the OS separator, `\` on
// Windows. The hook used to split on `/` to find the name being renamed, so
// on Windows the whole path was the name, `newPath` became the bare new
// name, and the backend refused it as a destination outside the vault — the
// Rust side of the fix was never reached. The name and the directory flag
// come from the tree entry now; only the last name changes, so the new path
// keeps whatever separator the tree used.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../ipc/invoke")>()),
  readFile: vi.fn(async () => ""),
  refreshIndex: vi.fn(async () => ({ fileCount: 0, linkCount: 0 })),
  renameFileWithLinks: vi.fn(),
  renameNamespace: vi.fn(),
}));

import { renameFileWithLinks, renameNamespace } from "../../../../ipc/invoke";
import { useEditorStore } from "../../../../stores/editor/editor";
import { useFileStore } from "../../../../stores/file/file";
import { useUIStore } from "../../../../stores/ui/ui";
import { useFileTreeRename } from "../use-file-tree-rename";

const renameFileEntry = vi.fn();
const renameTab = vi.fn();
const renameDirInTabs = vi.fn();
const showToast = vi.fn();

beforeEach(() => {
  vi.mocked(renameFileWithLinks).mockReset();
  vi.mocked(renameNamespace).mockReset();
  renameFileEntry.mockReset();
  renameTab.mockReset();
  renameDirInTabs.mockReset();
  showToast.mockReset();
  useFileStore.setState({
    fileTree: [
      { isDir: false, name: "b.md", path: "C:\\vault\\b.md" },
      {
        children: [
          { isDir: false, name: "in.md", path: "C:\\vault\\ns\\in.md" },
        ],
        isDir: true,
        name: "ns",
        path: "C:\\vault\\ns",
      },
    ],
    renameFileEntry,
    rootPath: "C:\\vault",
  });
  useEditorStore.setState({ renameDirInTabs, renameTab });
  useUIStore.setState({ showToast });
});

function confirm(oldPath: string, newName: string): Promise<void> {
  const { result } = renderHook(() => useFileTreeRename({ current: null }));
  return act(() => result.current.handleConfirmRename(oldPath, newName));
}

describe("renaming under Windows paths (issue 595)", () => {
  it("renames a directory with the separator the tree used", async () => {
    vi.mocked(renameNamespace).mockResolvedValue({
      filesMoved: 1,
      indexRebuilt: true,
      skippedFiles: [],
      uncheckedFiles: [],
      updatedFiles: [],
    });
    await confirm("C:\\vault\\ns", "ns2");

    expect(renameNamespace).toHaveBeenCalledWith(
      "C:\\vault\\ns",
      "C:\\vault\\ns2",
      "C:\\vault",
    );
    expect(renameFileWithLinks).not.toHaveBeenCalled();
    expect(renameFileEntry).toHaveBeenCalledWith(
      "C:\\vault\\ns",
      "C:\\vault\\ns2",
      "ns2",
    );
  });

  it("renames a file with the separator the tree used", async () => {
    vi.mocked(renameFileWithLinks).mockResolvedValue({
      skippedFiles: [],
      updatedFiles: [],
    });
    await confirm("C:\\vault\\b.md", "c.md");

    expect(renameFileWithLinks).toHaveBeenCalledWith(
      "C:\\vault\\b.md",
      "C:\\vault\\c.md",
    );
    expect(renameNamespace).not.toHaveBeenCalled();
  });

  it("does nothing when the name did not change", async () => {
    await confirm("C:\\vault\\ns", "ns");

    expect(renameNamespace).not.toHaveBeenCalled();
    expect(renameFileWithLinks).not.toHaveBeenCalled();
  });

  it("CONTROL: a path the tree does not know falls back to the name after the last slash", async () => {
    vi.mocked(renameFileWithLinks).mockResolvedValue({
      skippedFiles: [],
      updatedFiles: [],
    });
    await confirm("/elsewhere/x.md", "y.md");

    expect(renameFileWithLinks).toHaveBeenCalledWith(
      "/elsewhere/x.md",
      "/elsewhere/y.md",
    );
  });
});
