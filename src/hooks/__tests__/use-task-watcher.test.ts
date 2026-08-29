// §304/I1 — 워처의 증분 갱신이 vault 전체 스캔과 같은 exclude 규칙을 적용하는지
// 실제 seam(리스너 등록 → 이벤트 → getFileTasks 호출 → 스토어 반영)으로 확인한다.
import type { TaskEntry } from "../../ipc/types";

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

const getFileTasks = vi.fn();
vi.mock("../../ipc/invoke", () => ({
  getFileTasks: (...a: unknown[]) => getFileTasks(...a),
}));

import { listen } from "@tauri-apps/api/event";

import { useSettingsStore } from "../../stores/settings/store";
import { useTaskStore } from "../../stores/tasks/task-store";
import { useTaskWatcher } from "../use-task-watcher";

const handlers = new Map<string, (e: { payload: unknown }) => void>();

function entry(path: string): TaskEntry {
  return {
    cancelled: null,
    created: null,
    done: null,
    due: null,
    indent: 0,
    line: 0,
    links: [],
    path,
    priority: 0,
    raw: "- [ ] 하나",
    recurrence: null,
    scheduled: null,
    start: null,
    state: "todo",
    tags: [],
    text: "하나",
  };
}

/** 실제 Rust `is_excluded`와 같은 규칙 — 이 mock으로 args 배선을 검증한다. */
function fakeGetFileTasks(
  path: string,
  rootPath?: null | string,
  exclude: string[] = [],
): Promise<TaskEntry[]> {
  const rel = rootPath ? path.slice(rootPath.length + 1) : path;
  const excluded = exclude.some((e) => rel === e || rel.startsWith(`${e}/`));
  return Promise.resolve(excluded ? [] : [entry(path)]);
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("useTaskWatcher exclude wiring (I1)", () => {
  beforeEach(() => {
    handlers.clear();
    getFileTasks.mockReset().mockImplementation(fakeGetFileTasks);
    vi.mocked(listen).mockImplementation(async (event, handler) => {
      handlers.set(event, handler as (e: { payload: unknown }) => void);
      return () => handlers.delete(event);
    });
    useTaskStore.getState().clear();
    // §312.1 워처는 **마지막 전체 스캔이 실제로 걷은 루트**를 읽는다 — 설정과 컨텍스트를
    // 다시 조합하지 않는다. 두 벌이 갈리면 워처가 목록에 없는 파일을 넣거나 있는 파일을
    // 빠뜨린다.
    useTaskStore.getState().setRoots(["/vault"]);
    useSettingsStore.setState({
      tasksEnabled: true,
      tasksExcludePaths: ["archive"],
    });
  });

  it("does not add entries for a file:changed event under an excluded path", async () => {
    renderHook(() => useTaskWatcher());
    await flush();

    act(() => {
      handlers.get("file:changed")?.({
        payload: { path: "/vault/archive/old.md" },
      });
    });
    await flush();

    expect(getFileTasks).toHaveBeenCalledWith(
      "/vault/archive/old.md",
      "/vault",
      ["archive"],
    );
    expect(useTaskStore.getState().tasks).toEqual([]);
  });

  it("ignores a file outside every scan root — it is not in the list", async () => {
    // §312.1 범위 밖 파일의 태스크는 지금 목록에 있으면 안 된다. 종전에는 언제나
    // `rootPath`를 대고 인덱싱했으므로, 범위를 좁혀 둔 사용자에게 방금 저장한 다른
    // vault의 태스크가 목록에 되살아났다.
    renderHook(() => useTaskWatcher());
    await flush();

    act(() => {
      handlers.get("file:changed")?.({ payload: { path: "/elsewhere/x.md" } });
    });
    await flush();

    expect(getFileTasks).not.toHaveBeenCalled();
    expect(useTaskStore.getState().tasks).toEqual([]);
  });

  it("uses the root that actually covers the file, not the active vault", async () => {
    // 여러 루트를 스캔하는 범위에서 엉뚱한 루트를 대면 `exclude`가 그 파일에만 다르게
    // 적용된다 — I1이 막으려던 것과 같은 어긋남이 증분 경로에서만 되살아난다.
    useTaskStore.getState().setRoots(["/vault", "/other"]);
    renderHook(() => useTaskWatcher());
    await flush();

    act(() => {
      handlers.get("file:changed")?.({
        payload: { path: "/other/archive/old.md" },
      });
    });
    await flush();

    expect(getFileTasks).toHaveBeenCalledWith(
      "/other/archive/old.md",
      "/other",
      ["archive"],
    );
    expect(useTaskStore.getState().tasks).toEqual([]);
  });

  it("does not let a same-prefix neighbour root claim the file", async () => {
    // `/vaults`가 `/vault`에 걸리면 이웃 볼트의 파일이 남의 루트 기준으로 판정되어,
    // `exclude`가 엉뚱한 상대 경로에 적용된다(`dedupeScanRoots`가 막는 것과 같은 결함).
    useTaskStore.getState().setRoots(["/vault"]);
    renderHook(() => useTaskWatcher());
    await flush();

    act(() => {
      handlers.get("file:changed")?.({ payload: { path: "/vaults/x.md" } });
    });
    await flush();

    expect(getFileTasks).not.toHaveBeenCalled();
    expect(useTaskStore.getState().tasks).toEqual([]);
  });

  it("still adds entries for a file:changed event outside the excluded path", async () => {
    renderHook(() => useTaskWatcher());
    await flush();

    act(() => {
      handlers.get("file:changed")?.({ payload: { path: "/vault/keep.md" } });
    });
    await flush();

    expect(useTaskStore.getState().tasks.map((t) => t.path)).toEqual([
      "/vault/keep.md",
    ]);
  });

  it("does not add entries for a file:created event under an excluded path", async () => {
    renderHook(() => useTaskWatcher());
    await flush();

    act(() => {
      handlers.get("file:created")?.({
        payload: { isDir: false, path: "/vault/archive/new.md" },
      });
    });
    await flush();

    expect(useTaskStore.getState().tasks).toEqual([]);
  });
});
