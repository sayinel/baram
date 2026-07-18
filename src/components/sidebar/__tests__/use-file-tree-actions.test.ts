import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { writeText } = vi.hoisted(() => ({
  writeText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText }));

import { useFileStore } from "../../../stores/file/file";
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
