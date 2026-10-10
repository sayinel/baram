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

import { deleteDir, deleteFile, refreshIndex } from "../../../ipc/invoke";
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

// §29 지운 폴더의 노트를 index 에서 빼는 일은 Rust 의 삭제 명령이 돌려주기 전에 한다 — index 에 그
// 아래 항목이 남았는지로 디렉터리를 판정한다(issue 790, #824). 삭제 핸들러가 따로 build 하면 같은
// 삭제에 전체 build 가 한 번 더 붙는다.
describe("deletion leaves the link index to the watcher", () => {
  // 이것을 실패시키는 것: 폴더 삭제 뒤에 `refreshIndex(rootPath)` 를 다시 부른다.
  it("폴더 · 파일 · 일괄 삭제 모두 vault 를 다시 build 하지 않는다", async () => {
    const { result } = renderHook(() => useFileTreeCrud());
    await act(() => result.current.handleDelete("/r/docs"));
    await act(() => result.current.handleDeleteMany(["/r/b.md", "/r/c.md"]));
    expect(deleteDir).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledTimes(2);
    expect(refreshIndex).not.toHaveBeenCalled();
  });
});
