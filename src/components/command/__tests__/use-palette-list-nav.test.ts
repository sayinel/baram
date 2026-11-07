import type { KeyboardEvent } from "react";

// §4.5/§35 Bounds regression: itemCount === 0 must never drive selectedIndex negative
// or let Enter fire onEnter with an out-of-range index (array[-1] crash in consumers).
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { usePaletteListNav } from "../use-palette-list-nav";

function key(k: string): KeyboardEvent {
  return {
    key: k,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent;
}

function makeArgs(over: Partial<Parameters<typeof usePaletteListNav>[0]> = {}) {
  return {
    isOpen: true,
    itemCount: 0,
    onEnter: vi.fn(),
    onEscape: vi.fn(),
    ...over,
  };
}

describe("usePaletteListNav", () => {
  describe("itemCount === 0 (empty list)", () => {
    it("ArrowDown은 selectedIndex를 음수로 만들지 않는다", () => {
      const args = makeArgs();
      const { result } = renderHook(() => usePaletteListNav(args));

      act(() => result.current.handleKeyDown(key("ArrowDown")));

      expect(result.current.selectedIndex).toBe(0);
    });

    it("ArrowUp은 selectedIndex를 음수로 만들지 않는다", () => {
      const args = makeArgs();
      const { result } = renderHook(() => usePaletteListNav(args));

      act(() => result.current.handleKeyDown(key("ArrowUp")));

      expect(result.current.selectedIndex).toBe(0);
    });

    it("Enter는 onEnter를 호출하지 않는다", () => {
      const args = makeArgs();
      const { result } = renderHook(() => usePaletteListNav(args));

      act(() => result.current.handleKeyDown(key("Enter")));

      expect(args.onEnter).not.toHaveBeenCalled();
    });

    it("ArrowDown 이후에도 Enter는 onEnter를 호출하지 않는다", () => {
      const args = makeArgs();
      const { result } = renderHook(() => usePaletteListNav(args));

      act(() => result.current.handleKeyDown(key("ArrowDown")));
      act(() => result.current.handleKeyDown(key("Enter")));

      expect(args.onEnter).not.toHaveBeenCalled();
    });
  });

  describe("목록이 0으로 줄어드는 clamp 이펙트", () => {
    it("itemCount가 0으로 줄어들면 selectedIndex는 음수가 아닌 0으로 클램프된다", () => {
      const args = makeArgs({ itemCount: 3 });
      const { result, rerender } = renderHook(
        (props: Parameters<typeof usePaletteListNav>[0]) =>
          usePaletteListNav(props),
        { initialProps: args },
      );

      act(() => result.current.setSelectedIndex(2));
      expect(result.current.selectedIndex).toBe(2);

      rerender({ ...args, itemCount: 0 });

      expect(result.current.selectedIndex).toBe(0);
    });
  });

  describe("itemCount > 0 (기존 동작 보존)", () => {
    it("ArrowDown은 마지막 인덱스에서 클램프된다", () => {
      const args = makeArgs({ itemCount: 2 });
      const { result } = renderHook(() => usePaletteListNav(args));

      act(() => result.current.handleKeyDown(key("ArrowDown")));
      act(() => result.current.handleKeyDown(key("ArrowDown")));
      act(() => result.current.handleKeyDown(key("ArrowDown")));

      expect(result.current.selectedIndex).toBe(1);
    });

    it("Enter는 유효한 인덱스에서 onEnter를 호출한다", () => {
      const args = makeArgs({ itemCount: 2 });
      const { result } = renderHook(() => usePaletteListNav(args));

      act(() => result.current.handleKeyDown(key("ArrowDown")));
      act(() => result.current.handleKeyDown(key("Enter")));

      expect(args.onEnter).toHaveBeenCalledWith(1);
    });

    it("Escape는 onEscape를 호출한다", () => {
      const args = makeArgs({ itemCount: 2 });
      const { result } = renderHook(() => usePaletteListNav(args));

      act(() => result.current.handleKeyDown(key("Escape")));

      expect(args.onEscape).toHaveBeenCalled();
    });
  });

  // §385 플러그인 선택창은 onEscape 안에서 포커스를 연 자리(편집기에서 열었으면 편집기)로
  // 돌려준다. 취소되지 않은 Escape keydown 뒤에 macOS WebView 가 보내는 keypress(charCode 27)는
  // 그 편집기에 닿고, 선택이 한 부모 안의 텍스트 선택이 아니면 ProseMirror 가 그 글자를 문서에
  // 넣는다(2026-11-04 실측). Escape 를 뺀 행은 수정 전에도 통과했다 — 검사 자체를 고정한다.
  describe("다루는 키는 기본 동작을 취소한다", () => {
    it.each(["Escape", "ArrowDown", "ArrowUp", "Enter"])("%s", (k) => {
      const args = makeArgs({ itemCount: 2 });
      const { result } = renderHook(() => usePaletteListNav(args));
      const e = key(k);

      act(() => result.current.handleKeyDown(e));

      expect(e.preventDefault).toHaveBeenCalled();
    });
  });
});
