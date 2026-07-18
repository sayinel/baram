import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useFileStore } from "../../../stores/file/file";
import { useFileTreeCrud } from "../hooks/use-file-tree-crud";

vi.mock("../../../ipc/invoke", () => ({
  createDir: vi.fn().mockResolvedValue(undefined),
  deleteDir: vi.fn().mockResolvedValue(undefined),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  listDir: vi.fn().mockResolvedValue([]),
  refreshIndex: vi.fn().mockResolvedValue(undefined),
  setVaultRoot: vi.fn().mockResolvedValue(undefined),
  getFilesByTag: vi.fn().mockResolvedValue([]),
  getLinkIndex: vi.fn().mockResolvedValue({ links: [], backlinks: [] }),
  // tauri-storage calls these via ipc/invoke re-exports
  getConfig: vi.fn().mockResolvedValue(null),
  setConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../utils/confirm-dialog", () => ({
  showConfirm: vi.fn().mockResolvedValue(true),
  showAlert: vi.fn().mockResolvedValue(undefined),
}));

import { deleteDir, deleteFile } from "../../../ipc/invoke";
import { showAlert, showConfirm } from "../../../utils/confirm-dialog";

beforeEach(() => {
  vi.clearAllMocks();
  useFileStore.setState({
    rootPath: "/r",
    fileTree: [
      {
        name: "docs",
        path: "/r/docs",
        isDir: true,
        children: [{ name: "a.md", path: "/r/docs/a.md", isDir: false }],
      },
      { name: "b.md", path: "/r/b.md", isDir: false },
      { name: "c.md", path: "/r/c.md", isDir: false },
    ],
  });
});

describe("handleDeleteMany", () => {
  it("확인 1회 후 각 항목을 타입별 IPC로 삭제한다", async () => {
    const { result } = renderHook(() => useFileTreeCrud());
    await act(() => result.current.handleDeleteMany(["/r/b.md", "/r/docs"]));
    expect(showConfirm).toHaveBeenCalledTimes(1);
    expect(vi.mocked(showConfirm).mock.calls[0][0]).toContain("2 items");
    expect(deleteFile).toHaveBeenCalledWith("/r/b.md");
    expect(deleteDir).toHaveBeenCalledWith("/r/docs");
  });

  it("조상이 선택되면 자손은 삭제 호출에서 제외된다", async () => {
    const { result } = renderHook(() => useFileTreeCrud());
    await act(() =>
      result.current.handleDeleteMany(["/r/docs", "/r/docs/a.md"]),
    );
    expect(deleteFile).not.toHaveBeenCalled();
    expect(deleteDir).toHaveBeenCalledTimes(1);
  });

  it("일부 실패 시 나머지는 계속 진행하고 showAlert로 보고한다", async () => {
    vi.mocked(deleteFile).mockRejectedValueOnce(new Error("locked"));
    const { result } = renderHook(() => useFileTreeCrud());
    await act(() => result.current.handleDeleteMany(["/r/b.md", "/r/c.md"]));
    expect(deleteFile).toHaveBeenCalledTimes(2);
    expect(showAlert).toHaveBeenCalledTimes(1);
    expect(vi.mocked(showAlert).mock.calls[0][0]).toContain("b.md");
  });

  it("1개 경로는 단일 삭제 플로우(파일명 포함 문구)로 위임한다", async () => {
    const { result } = renderHook(() => useFileTreeCrud());
    await act(() => result.current.handleDeleteMany(["/r/b.md"]));
    expect(vi.mocked(showConfirm).mock.calls[0][0]).toContain('"b.md"');
  });
});
