// issue 531 — the refusal toast retires ITSELF and nothing else.
//
// The store's toast ids are not unique over time: `showToast` derives the
// next id from the current toast, so ids restart at 1 whenever the slot is
// empty. A hook that remembered the id would, after its own toast had
// auto-dismissed, retire an unrelated toast that happened to be reissued
// id 1. Identity of the toast object is what the hook compares.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useUIStore } from "../../../../stores/ui/ui";
import { useRefusedCommitToast } from "../use-refused-commit-toast";

beforeEach(() => {
  useUIStore.getState().dismissToast();
});

describe("useRefusedCommitToast", () => {
  it("settle retires the refusal toast it announced", () => {
    const { result } = renderHook(() => useRefusedCommitToast());
    act(() => result.current.announce("not saved"));
    expect(useUIStore.getState().toast?.message).toBe("not saved");

    act(() => result.current.settle());
    expect(useUIStore.getState().toast).toBeNull();
  });

  it("settle leaves an unrelated toast alone even when it reuses the same id", () => {
    const { result } = renderHook(() => useRefusedCommitToast());
    act(() => result.current.announce("not saved"));
    const ownId = useUIStore.getState().toast?.id;

    // Ours goes away (auto-dismiss / user), then someone else shows one —
    // and the store hands out the same id again.
    act(() => useUIStore.getState().dismissToast());
    act(() => useUIStore.getState().showToast("saved as PNG"));
    expect(useUIStore.getState().toast?.id).toBe(ownId);

    act(() => result.current.settle());
    expect(useUIStore.getState().toast?.message).toBe("saved as PNG");
  });

  it("settle without a pending refusal is a no-op", () => {
    const { result } = renderHook(() => useRefusedCommitToast());
    act(() => useUIStore.getState().showToast("unrelated"));

    act(() => result.current.settle());
    expect(useUIStore.getState().toast?.message).toBe("unrelated");
  });
});
