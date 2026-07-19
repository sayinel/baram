import type { NavEntry } from "../file-tree-keyboard-nav";

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useFileTreeKeyboard } from "../hooks/use-file-tree-keyboard";

const navEntries: NavEntry[] = [
  { path: "/r/docs", isDir: true },
  { path: "/r/docs/a.md", isDir: false },
  { path: "/r/z.md", isDir: false },
];
const visiblePaths = navEntries.map((e) => e.path);

function key(k: string, shift = false): React.KeyboardEvent {
  return {
    key: k,
    shiftKey: shift,
    preventDefault: vi.fn(),
  } as unknown as React.KeyboardEvent;
}

function makeArgs(
  over: Partial<Parameters<typeof useFileTreeKeyboard>[0]> = {},
) {
  return {
    navEntries,
    visiblePaths,
    rootPath: "/r",
    expandedDirs: new Set<string>(["/r/docs"]),
    expandDir: vi.fn(),
    toggleExpandedDir: vi.fn(),
    selectSingle: vi.fn(),
    selectRange: vi.fn(),
    onOpenFile: vi.fn(),
    ...over,
  };
}

describe("useFileTreeKeyboard", () => {
  it("ArrowDown은 focus를 다음으로 옮기고 selectSingle을 호출한다", () => {
    const args = makeArgs();
    const { result } = renderHook(() => useFileTreeKeyboard(args));
    act(() => result.current.setFocusedPath("/r/docs"));
    act(() => result.current.handleNavKeyDown(key("ArrowDown")));
    expect(result.current.focusedPath).toBe("/r/docs/a.md");
    expect(args.selectSingle).toHaveBeenCalledWith("/r/docs/a.md");
  });

  it("focus가 없을 때 ArrowDown은 첫 항목으로 간다", () => {
    const args = makeArgs();
    const { result } = renderHook(() => useFileTreeKeyboard(args));
    act(() => result.current.handleNavKeyDown(key("ArrowDown")));
    expect(result.current.focusedPath).toBe("/r/docs");
  });

  it("Shift+ArrowDown은 selectRange를 호출한다(단일선택 대신)", () => {
    const args = makeArgs();
    const { result } = renderHook(() => useFileTreeKeyboard(args));
    act(() => result.current.setFocusedPath("/r/docs"));
    act(() => result.current.handleNavKeyDown(key("ArrowDown", true)));
    expect(args.selectRange).toHaveBeenCalledWith("/r/docs/a.md", visiblePaths);
    expect(args.selectSingle).not.toHaveBeenCalled();
  });

  it("ArrowRight: 접힌 폴더는 expandDir", () => {
    const args = makeArgs({ expandedDirs: new Set<string>() });
    const { result } = renderHook(() => useFileTreeKeyboard(args));
    act(() => result.current.setFocusedPath("/r/docs"));
    act(() => result.current.handleNavKeyDown(key("ArrowRight")));
    expect(args.expandDir).toHaveBeenCalledWith("/r/docs");
  });

  it("ArrowRight: 펼친 폴더는 첫 자식으로 focus 이동", () => {
    const args = makeArgs(); // docs 펼침
    const { result } = renderHook(() => useFileTreeKeyboard(args));
    act(() => result.current.setFocusedPath("/r/docs"));
    act(() => result.current.handleNavKeyDown(key("ArrowRight")));
    expect(result.current.focusedPath).toBe("/r/docs/a.md");
  });

  it("ArrowLeft: 펼친 폴더는 접기(toggleExpandedDir)", () => {
    const args = makeArgs();
    const { result } = renderHook(() => useFileTreeKeyboard(args));
    act(() => result.current.setFocusedPath("/r/docs"));
    act(() => result.current.handleNavKeyDown(key("ArrowLeft")));
    expect(args.toggleExpandedDir).toHaveBeenCalledWith("/r/docs");
  });

  it("ArrowLeft: 자식 파일은 부모로 focus 이동", () => {
    const args = makeArgs();
    const { result } = renderHook(() => useFileTreeKeyboard(args));
    act(() => result.current.setFocusedPath("/r/docs/a.md"));
    act(() => result.current.handleNavKeyDown(key("ArrowLeft")));
    expect(result.current.focusedPath).toBe("/r/docs");
  });

  it("Enter: 파일은 onOpenFile, 폴더는 toggleExpandedDir", () => {
    const args = makeArgs();
    const { result } = renderHook(() => useFileTreeKeyboard(args));
    act(() => result.current.setFocusedPath("/r/z.md"));
    act(() => result.current.handleNavKeyDown(key("Enter")));
    expect(args.onOpenFile).toHaveBeenCalledWith("/r/z.md");
    act(() => result.current.setFocusedPath("/r/docs"));
    act(() => result.current.handleNavKeyDown(key("Enter")));
    expect(args.toggleExpandedDir).toHaveBeenCalledWith("/r/docs");
  });
});
