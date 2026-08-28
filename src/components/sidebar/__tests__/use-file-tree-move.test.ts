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

import { useEditorStore } from "../../../stores/editor/editor";
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
  // Reset so tests that set tabs don't leak into later tests via the
  // module-level store singleton.
  useEditorStore.setState({ tabs: [] });
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

  it("조상과 자손이 함께 이동 대상이면 자손을 prune하여 폴더만 이동한다", async () => {
    useFileStore.setState({
      rootPath: "/r",
      fileTree: [
        {
          name: "docs",
          path: "/r/docs",
          isDir: true,
          children: [{ name: "a.md", path: "/r/docs/a.md", isDir: false }],
        },
        { name: "dest", path: "/r/dest", isDir: true, children: [] },
      ],
    });
    const { result } = renderHook(() => useFileTreeMove());
    await act(() =>
      result.current.moveEntries(["/r/docs", "/r/docs/a.md"], "/r/dest"),
    );
    // only the folder is renamed on disk; the descendant rides along inside it
    expect(renameFile).toHaveBeenCalledWith("/r/docs", "/r/dest/docs");
    expect(renameFile).not.toHaveBeenCalledWith("/r/docs/a.md", "/r/dest/a.md");
  });

  // Guards a file-onto-file collision: previously renameFile succeeded by
  // overwriting the destination on disk, while the tree's idempotent
  // moveInTree silently kept the pre-existing destination node — leaving
  // disk, tree, openFiles, and open tabs in mutually inconsistent states.
  // The fix rejects the move before the IPC call when the destination path
  // already exists in the tree, so none of those layers change.
  it("목적지에 동일 경로가 이미 있으면 rename을 호출하지 않고 실패로 보고한다", async () => {
    useFileStore.setState({
      rootPath: "/r",
      fileTree: [
        { name: "a.md", path: "/r/a.md", isDir: false },
        {
          name: "dest",
          path: "/r/dest",
          isDir: true,
          children: [
            {
              name: "a.md",
              path: "/r/dest/a.md",
              isDir: false,
              modifiedAt: 42,
            },
          ],
        },
      ],
      openFiles: new Map([["/r/a.md", "content"]]),
    });
    useEditorStore.setState({
      tabs: [
        {
          id: "t1",
          filePath: "/r/a.md",
          title: "a.md",
          isDirty: false,
          isPinned: false,
          contextId: "",
        },
      ],
    });

    const { result } = renderHook(() => useFileTreeMove());
    await act(() => result.current.moveEntries(["/r/a.md"], "/r/dest"));

    expect(renameFile).not.toHaveBeenCalled();
    expect(showAlert).toHaveBeenCalledTimes(1);
    expect(showAlert.mock.calls[0][0]).toContain("a.md");

    const state = useFileStore.getState();
    expect(state.fileTree.some((e) => e.path === "/r/a.md")).toBe(true);
    const dest = state.fileTree.find((e) => e.path === "/r/dest");
    expect(dest?.children?.map((c) => c.path)).toEqual(["/r/dest/a.md"]);
    expect(dest?.children?.[0].modifiedAt).toBe(42);
    expect(state.openFiles.get("/r/a.md")).toBe("content");
    expect(useEditorStore.getState().tabs[0]?.filePath).toBe("/r/a.md");
  });

  // The team lead's design requires the batch to continue past a rejected
  // item — this exercises the `continue`-from-guard branch specifically
  // (distinct from the existing "continue after a thrown rename error" case
  // above), alongside a sibling move that should succeed normally.
  it("배치 이동 중 하나가 목적지 충돌로 거부돼도 나머지는 계속 진행한다", async () => {
    useFileStore.setState({
      rootPath: "/r",
      fileTree: [
        { name: "a.md", path: "/r/a.md", isDir: false },
        { name: "b.md", path: "/r/b.md", isDir: false },
        {
          name: "dest",
          path: "/r/dest",
          isDir: true,
          children: [{ name: "a.md", path: "/r/dest/a.md", isDir: false }],
        },
      ],
    });

    const { result } = renderHook(() => useFileTreeMove());
    await act(() =>
      result.current.moveEntries(["/r/a.md", "/r/b.md"], "/r/dest"),
    );

    expect(renameFile).toHaveBeenCalledTimes(1);
    expect(renameFile).toHaveBeenCalledWith("/r/b.md", "/r/dest/b.md");
    expect(renameFile).not.toHaveBeenCalledWith("/r/a.md", "/r/dest/a.md");

    const dest = useFileStore
      .getState()
      .fileTree.find((e) => e.path === "/r/dest");
    expect(dest?.children?.map((c) => c.path).sort()).toEqual([
      "/r/dest/a.md",
      "/r/dest/b.md",
    ]);

    expect(showAlert).toHaveBeenCalledTimes(1);
    expect(showAlert.mock.calls[0][0]).toContain("a.md");
    expect(showAlert.mock.calls[0][0]).not.toContain("b.md");
  });
});
