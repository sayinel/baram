// src/hooks/__tests__/use-auto-snapshot.test.ts
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const performAutoSnapshot = vi.fn().mockResolvedValue(undefined);
vi.mock("../../stores/editor/snapshot", () => ({
  useSnapshotStore: { getState: () => ({ performAutoSnapshot }) },
}));

let rootPath: null | string = "/vault";
vi.mock("../../stores/file/file", () => ({
  useFileStore: (sel: (s: { rootPath: null | string }) => unknown) =>
    sel({ rootPath }),
}));

let intervalMinutes = 30;
vi.mock("../use-resolved-settings", () => ({
  useResolvedSettings: () => ({ snapshotIntervalMinutes: intervalMinutes }),
}));

import { useAutoSnapshot } from "../use-auto-snapshot";

beforeEach(() => {
  vi.useFakeTimers();
  rootPath = "/vault";
  intervalMinutes = 30;
  performAutoSnapshot.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("useAutoSnapshot", () => {
  it("calls performAutoSnapshot(rootPath) each interval", () => {
    renderHook(() => useAutoSnapshot());
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(performAutoSnapshot).toHaveBeenCalledWith("/vault");
  });

  it("does not run when interval is 0 (disabled)", () => {
    intervalMinutes = 0;
    renderHook(() => useAutoSnapshot());
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(performAutoSnapshot).not.toHaveBeenCalled();
  });

  it("does not run when no vault is open", () => {
    rootPath = null;
    renderHook(() => useAutoSnapshot());
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(performAutoSnapshot).not.toHaveBeenCalled();
  });
});
