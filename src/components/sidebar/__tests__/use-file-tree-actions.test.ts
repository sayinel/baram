import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { writeText } = vi.hoisted(() => ({
  writeText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText }));

const { copyFile } = vi.hoisted(() => ({
  copyFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../ipc/invoke", () => ({
  copyFile,
  listDir: vi.fn(),
  refreshIndex: vi.fn(),
  setVaultRoot: vi.fn(),
  getConfig: vi.fn().mockResolvedValue(null),
  setConfig: vi.fn().mockResolvedValue(undefined),
  removeConfig: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(""),
}));

const revealItemInDir = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir }));

import { revealItemInDir as revealMock } from "@tauri-apps/plugin-opener";

import { readFile } from "../../../ipc/invoke";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { useUIStore } from "../../../stores/ui/ui";
import { useFileTreeActions } from "../hooks/use-file-tree-actions";

beforeEach(() => {
  writeText.mockClear();
  useFileStore.setState({
    rootPath: "/r",
    fileTree: [
      { name: "a.md", path: "/r/a.md", isDir: false },
      {
        name: "docs",
        path: "/r/docs",
        isDir: true,
        children: [{ name: "a.md", path: "/r/docs/a.md", isDir: false }],
      },
    ],
  });
  useEditorStore.setState({ tabs: [], activeTabId: null, mruOrder: [] });
});

describe("useFileTreeActions copy", () => {
  it("copyPath는 절대 경로를 클립보드에 쓴다", async () => {
    const { result } = renderHook(() => useFileTreeActions());
    await act(() => result.current.copyPath("/r/docs/a.md"));
    expect(writeText).toHaveBeenCalledWith("/r/docs/a.md");
  });
  it("copyRelativePath는 vault 상대 경로를 쓴다", async () => {
    const { result } = renderHook(() => useFileTreeActions());
    await act(() => result.current.copyRelativePath("/r/docs/a.md"));
    expect(writeText).toHaveBeenCalledWith("docs/a.md");
  });
  it("copyWikilink는 동명 충돌 시 상대 경로 라벨을 [[...]]로 쓴다", async () => {
    const { result } = renderHook(() => useFileTreeActions());
    await act(() => result.current.copyWikilink("/r/docs/a.md"));
    expect(writeText).toHaveBeenCalledWith("[[docs/a]]");
  });
});

describe("useFileTreeActions duplicate", () => {
  it("파일을 name-1.ext로 복제하고 트리에 추가한다", async () => {
    const { result } = renderHook(() => useFileTreeActions());
    await act(() => result.current.duplicateFile("/r/a.md"));
    expect(copyFile).toHaveBeenCalledWith("/r/a.md", "/r/a-1.md");
    const tree = useFileStore.getState().fileTree;
    expect(tree.some((e) => e.path === "/r/a-1.md")).toBe(true);
  });
});

describe("useFileTreeActions reveal", () => {
  it("revealInFileManager는 경로로 revealItemInDir를 호출한다", async () => {
    const { result } = renderHook(() => useFileTreeActions());
    await act(() => result.current.revealInFileManager("/r/docs/a.md"));
    expect(revealMock).toHaveBeenCalledWith("/r/docs/a.md");
  });
});

describe("useFileTreeActions open/export", () => {
  it("openInNewTab은 파일을 읽어 탭을 연다", async () => {
    const { result } = renderHook(() => useFileTreeActions());
    await act(() => result.current.openInNewTab("/r/a.md"));
    const tabs = useEditorStore.getState().tabs;
    expect(tabs.some((t) => t.filePath === "/r/a.md")).toBe(true);
  });
  it("exportFile은 탭을 열고 export 다이얼로그를 연다", async () => {
    const spy = vi.spyOn(useUIStore.getState(), "openExportDialog");
    const { result } = renderHook(() => useFileTreeActions());
    await act(() => result.current.exportFile("/r/a.md"));
    expect(spy).toHaveBeenCalledWith("pdf");
  });
  it("openInNewTab이 실패하면 exportFile은 export 다이얼로그를 열지 않는다", async () => {
    const { result } = renderHook(() => useFileTreeActions());
    // readFile를 이번 호출에서만 실패시킨다
    vi.mocked(readFile).mockRejectedValueOnce(new Error("gone"));
    const spy = vi.spyOn(useUIStore.getState(), "openExportDialog");
    spy.mockClear(); // 이전 테스트에서 동일 스파이가 누적한 호출 기록 제거
    await act(() => result.current.exportFile("/r/missing.md"));
    expect(spy).not.toHaveBeenCalled();
  });
});
