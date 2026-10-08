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
    onIndexChanged({
      entries: [{ canonical: path, spellings: [path] }],
      rebuilt: [],
    });
  }),
}));

import { onIndexChanged } from "../../../../services/index-changes";
import { useEditorStore } from "../../../../stores/editor/editor";
import { useLinkStore } from "../../../../stores/editor/link";
import { useFileStore } from "../../../../stores/file/file";
import { useFileTreeCrud } from "../use-file-tree-crud";

beforeEach(() => {
  useFileStore.setState({
    fileTree: [{ isDir: false, name: "a.md", path: "/vault/a.md" }],
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
