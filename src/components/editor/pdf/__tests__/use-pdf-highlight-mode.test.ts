// §276.3.1 usePdfHighlightMode — the shared three-state mode. Mutual
// exclusivity is a property of a single enum, not cross-toggle logic, so
// these tests exist to pin exactly that: switching to one mode always
// clears the other, with no special-casing required.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { usePdfHighlightMode } from "../use-pdf-highlight-mode";

describe("usePdfHighlightMode", () => {
  it("starts at 'none'", () => {
    const { result } = renderHook(() => usePdfHighlightMode());
    expect(result.current.mode).toBe("none");
  });

  it("toggleTextMode turns text on, then off again", () => {
    const { result } = renderHook(() => usePdfHighlightMode());
    act(() => result.current.toggleTextMode());
    expect(result.current.mode).toBe("text");
    act(() => result.current.toggleTextMode());
    expect(result.current.mode).toBe("none");
  });

  it("toggleAreaMode turns area on, then off again", () => {
    const { result } = renderHook(() => usePdfHighlightMode());
    act(() => result.current.toggleAreaMode());
    expect(result.current.mode).toBe("area");
    act(() => result.current.toggleAreaMode());
    expect(result.current.mode).toBe("none");
  });

  it("switching to area while text is active turns text off (mutual exclusivity)", () => {
    const { result } = renderHook(() => usePdfHighlightMode());
    act(() => result.current.toggleTextMode());
    expect(result.current.mode).toBe("text");

    act(() => result.current.toggleAreaMode());
    expect(result.current.mode).toBe("area");
  });

  it("switching to text while area is active turns area off (mutual exclusivity)", () => {
    const { result } = renderHook(() => usePdfHighlightMode());
    act(() => result.current.toggleAreaMode());
    expect(result.current.mode).toBe("area");

    act(() => result.current.toggleTextMode());
    expect(result.current.mode).toBe("text");
  });

  it("clicking the ALREADY-active toggle again reaches 'none', not the other mode", () => {
    const { result } = renderHook(() => usePdfHighlightMode());
    act(() => result.current.toggleAreaMode());
    act(() => result.current.toggleAreaMode());
    expect(result.current.mode).toBe("none");
  });
});
