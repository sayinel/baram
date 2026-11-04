// §29 #824 Deleting a note from the tree bumps `indexVersion` exactly once: the delete
// command's own `index:changed` (stood in here by what Rust emits) is the only source.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../utils/confirm-dialog", () => ({
  showAlert: vi.fn(async () => {}),
  showConfirm: vi.fn(async () => true),
}));

vi.mock("../../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../ipc/invoke")>()),
  // What Rust's `delete_file` does once the file is gone and the index reconciled.
  deleteFile: vi.fn(async (path: string) => {
    announce(path);
  }),
  // What Rust's `rename_file` does once the file has moved: one event per command.
  renameFile: vi.fn(async (from: string) => {
    announce(from);
  }),
}));

function announce(path: string): void {
  onIndexChanged({
    entries: [{ canonical: path, spellings: [path] }],
    rebuilt: [],
  });
}

import { onIndexChanged } from "../../../../services/index-changes";
import { useEditorStore } from "../../../../stores/editor/editor";
import { useLinkStore } from "../../../../stores/editor/link";
import { useFileStore } from "../../../../stores/file/file";
import { useFileTreeCrud } from "../use-file-tree-crud";
import { useFileTreeMove } from "../use-file-tree-move";

beforeEach(() => {
  useFileStore.setState({
    fileTree: [
      { isDir: false, name: "a.md", path: "/vault/a.md" },
      { isDir: false, name: "b.md", path: "/vault/b.md" },
      { isDir: false, name: "c.md", path: "/vault/c.md" },
      { children: [], isDir: true, name: "dir", path: "/vault/dir" },
    ],
    openFiles: new Map(),
    rootPath: "/vault",
  });
  useEditorStore.setState({ activeTabId: null, tabs: [] });
  useLinkStore.setState({ indexVersion: 0, savedPath: null });
});

describe("deleting a note from the tree", () => {
  // 이것을 실패시키는 것: `handleDelete` 가 삭제 뒤 `invalidate()` 를 또 부른다(두 번 오른다).
  it("bumps indexVersion once, naming the deleted note", async () => {
    const { result } = renderHook(() => useFileTreeCrud());
    await act(() => result.current.handleDelete("/vault/a.md"));
    expect(useLinkStore.getState().indexVersion).toBe(1);
    expect(useLinkStore.getState().savedPath).toBe("/vault/a.md");
  });
});

// §29 #823 A batch is one command per item, each announcing its own `index:changed`; the
// panels that read `indexVersion` must hear the batch once, as they did when the tree bumped
// after its loop.
describe("a batch from the tree", () => {
  // 이것을 실패시키는 것: `handleDeleteMany` 의 `holdIndexBumps` 를 지운다(세 번 오른다).
  it("deleting three notes bumps indexVersion once", async () => {
    const { result } = renderHook(() => useFileTreeCrud());
    await act(() =>
      result.current.handleDeleteMany([
        "/vault/a.md",
        "/vault/b.md",
        "/vault/c.md",
      ]),
    );
    expect(useLinkStore.getState().indexVersion).toBe(1);
    expect(useLinkStore.getState().savedPath).toBeNull();
  });

  // 이것을 실패시키는 것: `moveEntries` 의 `holdIndexBumps` 를 지운다(세 번 오른다).
  it("moving three notes into a folder bumps indexVersion once", async () => {
    const { result } = renderHook(() => useFileTreeMove());
    await act(() =>
      result.current.moveEntries(
        ["/vault/a.md", "/vault/b.md", "/vault/c.md"],
        "/vault/dir",
      ),
    );
    expect(useLinkStore.getState().indexVersion).toBe(1);
  });
});
