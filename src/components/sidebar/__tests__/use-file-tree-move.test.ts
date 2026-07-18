import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { renameFile } = vi.hoisted(() => ({
  renameFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../ipc/invoke", () => ({
  renameFile,
  listDir: vi.fn().mockResolvedValue([]),
  refreshIndex: vi.fn().mockResolvedValue(undefined),
  setVaultRoot: vi.fn().mockResolvedValue(undefined),
  getLinkIndex: vi.fn().mockResolvedValue({ links: [], backlinks: [] }),
}));
const { showAlert } = vi.hoisted(() => ({
  showAlert: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../utils/confirm-dialog", () => ({ showAlert }));

import { useFileStore } from "../../../stores/file/file";
import { useFileTreeMove } from "../hooks/use-file-tree-move";

beforeEach(() => {
  renameFile.mockClear();
  showAlert.mockClear();
  useFileStore.setState({
    rootPath: "/r",
    fileTree: [
      { name: "a.md", path: "/r/a.md", isDir: false },
      { name: "b.md", path: "/r/b.md", isDir: false },
      { name: "dest", path: "/r/dest", isDir: true, children: [] },
    ],
  });
});

describe("useFileTreeMove", () => {
  it("유효한 이동은 renameFile을 항목별로 호출하고 트리를 갱신한다", async () => {
    const { result } = renderHook(() => useFileTreeMove());
    await act(() =>
      result.current.moveEntries(["/r/a.md", "/r/b.md"], "/r/dest"),
    );
    expect(renameFile).toHaveBeenCalledWith("/r/a.md", "/r/dest/a.md");
    expect(renameFile).toHaveBeenCalledWith("/r/b.md", "/r/dest/b.md");
    const dest = useFileStore
      .getState()
      .fileTree.find((e) => e.path === "/r/dest");
    expect(dest?.children?.map((c) => c.path).sort()).toEqual([
      "/r/dest/a.md",
      "/r/dest/b.md",
    ]);
  });

  it("일부 실패 시 나머지는 계속하고 showAlert로 보고한다", async () => {
    renameFile.mockRejectedValueOnce(new Error("locked"));
    const { result } = renderHook(() => useFileTreeMove());
    await act(() =>
      result.current.moveEntries(["/r/a.md", "/r/b.md"], "/r/dest"),
    );
    expect(renameFile).toHaveBeenCalledTimes(2);
    expect(showAlert).toHaveBeenCalledTimes(1);
  });
});
