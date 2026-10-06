// §29 워처가 앱 밖의 변경을 링크 index 에 파일 하나 갱신으로 반영하는지 — 실제 seam(리스너 등록 →
// 이벤트 → updateFileIndex / refreshIndex 호출 → indexVersion)으로 센다(issue 790).
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

const updateFileIndex = vi.fn();
const refreshIndex = vi.fn();
vi.mock("../../ipc/invoke", () => ({
  refreshIndex: (...a: unknown[]) => refreshIndex(...a),
  updateFileIndex: (...a: unknown[]) => updateFileIndex(...a),
}));

import { listen } from "@tauri-apps/api/event";

import { useLinkStore } from "../../stores/editor/link";
import { useFileStore } from "../../stores/file/file";
import { useLinkIndexWatcher } from "../use-link-index-watcher";

const handlers = new Map<string, (e: { payload: unknown }) => void>();

function emit(event: string, payload: unknown): void {
  act(() => handlers.get(event)?.({ payload }));
}

/** 리스너 등록과 flush 타이머(300 ms)를 지나 index 호출이 끝날 때까지. */
async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
}

function version(): number {
  return useLinkStore.getState().indexVersion;
}

beforeEach(() => {
  vi.useFakeTimers();
  handlers.clear();
  updateFileIndex.mockReset().mockResolvedValue(undefined);
  refreshIndex.mockReset().mockResolvedValue(undefined);
  vi.mocked(listen).mockImplementation(async (event, handler) => {
    handlers.set(event, handler as (e: { payload: unknown }) => void);
    return () => handlers.delete(event);
  });
  useLinkStore.setState({ indexVersion: 0 });
  useFileStore.setState({
    fileTree: [
      {
        children: [{ isDir: false, name: "a.md", path: "/v/docs/a.md" }],
        isDir: true,
        name: "docs",
        path: "/v/docs",
      },
    ],
    rootPath: "/v",
  });
});

describe("useLinkIndexWatcher", () => {
  // 이것을 실패시키는 것: `pending` 이 경로를 중복 없이 모으지 않는다(같은 경로를 두 번 담는다).
  it("updates one note per path for a burst of external events, and never rebuilds", async () => {
    renderHook(() => useLinkIndexWatcher());
    await settle();

    // FSEvents 는 한 번의 쓰기에 이벤트를 여럿 올린다 — 같은 경로는 한 번만 다시 읽는다.
    emit("file:changed", { origin: "external", path: "/v/x.md" });
    emit("file:changed", { origin: "external", path: "/v/x.md" });
    emit("file:created", { isDir: false, origin: "external", path: "/v/y.md" });
    emit("file:deleted", { path: "/v/z.md" });
    await settle();

    expect(updateFileIndex.mock.calls.map((c) => c[0]).sort()).toEqual([
      "/v/x.md",
      "/v/y.md",
      "/v/z.md",
    ]);
    expect(refreshIndex).not.toHaveBeenCalled();
    expect(version()).toBe(1);
  });

  // 이것을 실패시키는 것: 두 리스너의 `if (e.payload.origin === "app") return;` 중 하나를 지운다.
  it("skips the app's own writes — the save already updated the index", async () => {
    renderHook(() => useLinkIndexWatcher());
    await settle();

    emit("file:changed", { origin: "app", path: "/v/x.md" });
    emit("file:created", { isDir: false, origin: "app", path: "/v/x.md" });
    await settle();

    expect(updateFileIndex).not.toHaveBeenCalled();
    expect(version()).toBe(0);

    // 같은 경로의 외부 쓰기는 그대로 반영한다 — 위의 0 이 리스너가 죽어서가 아니다.
    emit("file:changed", { origin: "external", path: "/v/x.md" });
    await settle();
    expect(updateFileIndex).toHaveBeenCalledWith("/v/x.md");
  });

  // 이것을 실패시키는 것: `isNote` 검사를 지워 모든 경로를 `schedule(path)` 로 보낸다.
  it("ignores files that are not notes", async () => {
    renderHook(() => useLinkIndexWatcher());
    await settle();

    emit("file:changed", { origin: "external", path: "/v/pic.png" });
    emit("file:created", { isDir: false, origin: "external", path: "/v/4913" });
    emit("file:deleted", { path: "/v/4913" });
    await settle();

    expect(updateFileIndex).not.toHaveBeenCalled();
    expect(refreshIndex).not.toHaveBeenCalled();
    expect(version()).toBe(0);
  });

  // 이것을 실패시키는 것: `file:created` 의 `if (e.payload.isDir) schedule(null);` 을 지운다.
  it("rebuilds once when a directory appears — its notes come without events of their own", async () => {
    renderHook(() => useLinkIndexWatcher());
    await settle();

    emit("file:created", { isDir: true, origin: "external", path: "/v/new" });
    emit("file:changed", { origin: "external", path: "/v/x.md" });
    await settle();

    // 다시 build 하면 그 flush 의 노트 하나 갱신은 필요 없다 — build 가 다 읽는다.
    expect(refreshIndex).toHaveBeenCalledTimes(1);
    expect(refreshIndex).toHaveBeenCalledWith("/v");
    expect(updateFileIndex).not.toHaveBeenCalled();
    expect(version()).toBe(1);
  });

  // 이것을 실패시키는 것: `file:deleted` 의 `findEntryByPath(…)?.isDir` 분기를 지운다.
  it("rebuilds once when a directory the tree knows is deleted", async () => {
    renderHook(() => useLinkIndexWatcher());
    await settle();

    emit("file:deleted", { path: "/v/docs" });
    await settle();

    expect(refreshIndex).toHaveBeenCalledTimes(1);
    expect(version()).toBe(1);
  });
});
