import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/invoke", () => ({
  createSnapshot: vi.fn().mockResolvedValue("snap-1"),
  listSnapshots: vi.fn().mockResolvedValue([]),
  getFileHistory: vi.fn().mockResolvedValue([]),
  getSnapshotDiff: vi.fn(),
  deleteSnapshot: vi.fn(),
  restoreSnapshot: vi.fn(),
  readFile: vi.fn(),
}));

import { createSnapshot } from "../../../ipc/invoke";
import { useSnapshotStore } from "../snapshot";

beforeEach(() => {
  useSnapshotStore.setState({ pendingAutoSnapshot: false, snapshots: [] });
  vi.clearAllMocks();
});

describe("snapshot store — auto-snapshot gate", () => {
  it("markPendingAutoSnapshot sets the gate", () => {
    useSnapshotStore.getState().markPendingAutoSnapshot();
    expect(useSnapshotStore.getState().pendingAutoSnapshot).toBe(true);
  });

  it("performAutoSnapshot is a no-op when the gate is clear", async () => {
    await useSnapshotStore.getState().performAutoSnapshot("/vault");
    expect(createSnapshot).not.toHaveBeenCalled();
  });

  it("performAutoSnapshot creates an 'auto' snapshot and clears the gate when pending", async () => {
    useSnapshotStore.getState().markPendingAutoSnapshot();
    await useSnapshotStore.getState().performAutoSnapshot("/vault");
    expect(createSnapshot).toHaveBeenCalledWith("/vault", "auto", undefined);
    expect(useSnapshotStore.getState().pendingAutoSnapshot).toBe(false);
  });

  it("re-arms the gate if snapshot creation fails", async () => {
    (createSnapshot as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("disk full"),
    );
    useSnapshotStore.getState().markPendingAutoSnapshot();
    await useSnapshotStore.getState().performAutoSnapshot("/vault");
    expect(useSnapshotStore.getState().pendingAutoSnapshot).toBe(true);
  });
});
