import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useFileTreeSelection } from "../hooks/use-file-tree-selection";

const visible = ["/r/a.md", "/r/b.md", "/r/c.md", "/r/d.md"];

describe("useFileTreeSelection", () => {
  it("selectSingle은 선택을 1개로 교체한다", () => {
    const { result } = renderHook(() => useFileTreeSelection());
    act(() => result.current.selectSingle("/r/a.md"));
    act(() => result.current.selectSingle("/r/b.md"));
    expect([...result.current.selectedPaths]).toEqual(["/r/b.md"]);
  });

  it("toggleSelect는 추가/제거를 토글한다", () => {
    const { result } = renderHook(() => useFileTreeSelection());
    act(() => result.current.selectSingle("/r/a.md"));
    act(() => result.current.toggleSelect("/r/c.md"));
    expect([...result.current.selectedPaths].sort()).toEqual([
      "/r/a.md",
      "/r/c.md",
    ]);
    act(() => result.current.toggleSelect("/r/a.md"));
    expect([...result.current.selectedPaths]).toEqual(["/r/c.md"]);
  });

  it("selectRange는 앵커부터 대상까지 visible 순서로 선택한다 (역방향 포함)", () => {
    const { result } = renderHook(() => useFileTreeSelection());
    act(() => result.current.selectSingle("/r/c.md"));
    act(() => result.current.selectRange("/r/a.md", visible));
    expect([...result.current.selectedPaths].sort()).toEqual([
      "/r/a.md",
      "/r/b.md",
      "/r/c.md",
    ]);
  });

  it("연속 Shift 클릭은 같은 앵커에서 범위를 재계산한다", () => {
    const { result } = renderHook(() => useFileTreeSelection());
    act(() => result.current.selectSingle("/r/b.md"));
    act(() => result.current.selectRange("/r/d.md", visible));
    act(() => result.current.selectRange("/r/a.md", visible));
    expect([...result.current.selectedPaths].sort()).toEqual([
      "/r/a.md",
      "/r/b.md",
    ]);
  });

  it("앵커가 visible에 없으면 대상 단일 선택으로 폴백한다", () => {
    const { result } = renderHook(() => useFileTreeSelection());
    act(() => result.current.selectSingle("/gone.md"));
    act(() => result.current.selectRange("/r/b.md", visible));
    expect([...result.current.selectedPaths]).toEqual(["/r/b.md"]);
  });

  it("clearSelection은 선택을 비운다", () => {
    const { result } = renderHook(() => useFileTreeSelection());
    act(() => result.current.selectSingle("/r/a.md"));
    act(() => result.current.clearSelection());
    expect(result.current.selectedPaths.size).toBe(0);
  });
});
