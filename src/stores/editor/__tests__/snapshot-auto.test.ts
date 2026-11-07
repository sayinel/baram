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

// §3.5 (#798) 복원은 열린 파일을 다시 읽는다. 그 읽기 사이 탭이 닫혔으면 원문을 되살리지 않는다 — 어떤 닫기로도
// 내려가지 않고, watcher 가 그 파일을 열린 것으로 본다.
// 이것을 실패시키는 것: snapshot.ts 의 `tabs.some(...)` 관문을 빼면 첫째가 깨진다. 둘째는 탭이 남으면 원문을 쓰는 짝이다.
describe("snapshot store — restoring a file whose tab closes during the read", () => {
  async function restoreWhile(closeDuringRead: boolean) {
    const { useEditorStore } = await import("../editor");
    const { useFileStore } = await import("../../file/file");
    const { readFile, restoreSnapshot } = await import("../../../ipc/invoke");
    const full = "/vault/note.md";
    useFileStore.setState({ openFiles: new Map([[full, "before"]]) });
    useEditorStore.setState({
      activeTabId: "t",
      tabs: [
        {
          contextId: "c",
          filePath: full,
          id: "t",
          isDirty: false,
          isPinned: false,
          title: "note.md",
        },
      ],
    } as never);
    (restoreSnapshot as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    let finishRead: (text: string) => void = () => undefined;
    (readFile as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finishRead = resolve;
        }),
    );
    const restoring = useSnapshotStore
      .getState()
      .performRestore("/vault", "snap-1", ["note.md"]);
    await vi.waitFor(() => expect(readFile).toHaveBeenCalledWith(full));
    if (closeDuringRead) useEditorStore.setState({ tabs: [] } as never);
    finishRead("restored");
    await restoring;
    return useFileStore.getState().openFiles.get(full);
  }

  it("does not put the text back for a tab closed during the read", async () => {
    expect(await restoreWhile(true)).toBe("before");
  });

  it("puts the restored text in the cache while the tab stays", async () => {
    expect(await restoreWhile(false)).toBe("restored");
  });
});
