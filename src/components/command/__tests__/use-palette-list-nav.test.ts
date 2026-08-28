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
});
