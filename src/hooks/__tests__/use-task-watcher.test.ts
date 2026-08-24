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

import { useFileStore } from "../../stores/file/file";
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
    useFileStore.setState({ rootPath: "/vault" });
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
