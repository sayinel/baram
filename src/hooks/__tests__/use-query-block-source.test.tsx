// §310 쿼리 블록이 무엇을 싣는가 — 소스가 그것을 가른다.
import type { TaskEntry } from "../../ipc/types";

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getVaultTasks = vi.fn().mockResolvedValue([]);
const listDir = vi.fn().mockResolvedValue([]);

vi.mock("../../ipc/invoke", () => ({
  getVaultTasks: (...a: unknown[]) => getVaultTasks(...a),
  listDir: (...a: unknown[]) => listDir(...a),
  readFile: vi.fn().mockResolvedValue(""),
}));

import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { resultCount, useQueryBlock } from "../use-query-block";

function task(over: Partial<TaskEntry> = {}): TaskEntry {
  return {
    cancelled: null,
    created: null,
    done: null,
    due: null,
    indent: 0,
    line: 0,
    links: [],
    path: "/v/a.md",
    priority: 0,
    raw: "- [ ] x",
    recurrence: null,
    scheduled: null,
    start: null,
    state: "todo",
    tags: [],
    text: "x",
    timer: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getVaultTasks.mockResolvedValue([]);
  listDir.mockResolvedValue([]);
  useFileStore.setState({ rootPath: "/v" });
  useSettingsStore.setState({
    tasksEnabled: true,
    tasksExcludePaths: ["archive/"],
  });
});

describe("useQueryBlock — 소스 분기", () => {
  it("files는 종전 그대로 디렉터리를 훑는다", async () => {
    const { result } = renderHook(() => useQueryBlock());
    await act(async () => {
      await result.current.execute('filter: tags contains "a"');
    });

    expect(listDir).toHaveBeenCalledWith("/v", true);
    expect(getVaultTasks).not.toHaveBeenCalled();
    expect(result.current.results.source).toBe("files");
  });

  it("‼️ tasks는 파일을 읽지 않는다 — 인덱서 한 번이면 된다", () => {
    // files 경로는 모든 .md를 열어 프론트매터를 판다. 태스크 소스가 그것까지 하면
    // 같은 vault를 두 번 훑는다.
    getVaultTasks.mockResolvedValue([task({ text: "보드에 뜰 것" })]);
    const { result } = renderHook(() => useQueryBlock());
    return act(async () => {
      await result.current.execute("source: tasks");
    }).then(() => {
      expect(listDir).not.toHaveBeenCalled();
      expect(getVaultTasks).toHaveBeenCalledWith("/v", ["archive/"]);
      expect(resultCount(result.current.results)).toBe(1);
    });
  });

  it("‼️ 태스크 쿼리는 **문서가 사는 vault**를 본다 — 아젠다 범위가 아니다", async () => {
    // 사이드바 드롭다운이 문서의 내용을 바꾸면 같은 노트를 두 사람이 열었을 때 다른
    // 것을 보게 되고, 읽는 사람은 그 드롭다운을 보지도 못한다.
    useSettingsStore.setState({
      tasksScanScope: "tasksHome",
      tasksHome: "/home",
    });
    const { result } = renderHook(() => useQueryBlock());
    await act(async () => {
      await result.current.execute("source: tasks");
    });

    expect(getVaultTasks).toHaveBeenCalledWith("/v", ["archive/"]);
  });

  it("필터·정렬·제한이 태스크에도 걸린다", async () => {
    getVaultTasks.mockResolvedValue([
      task({ due: "2026-09-02", line: 1 }),
      task({ due: "2026-09-01", line: 2 }),
      task({ line: 3, state: "done" }),
    ]);
    const { result } = renderHook(() => useQueryBlock());
    await act(async () => {
      await result.current.execute(
        ["source: tasks", 'filter: state = "todo"', "sort: due asc"].join("\n"),
      );
    });

    const got = result.current.results;
    expect(got.source === "tasks" && got.tasks.map((t) => t.line)).toEqual([
      2, 1,
    ]);
  });

  it("태스크 기능이 꺼져 있으면 걷지 않고 이유를 올린다", async () => {
    useSettingsStore.setState({ tasksEnabled: false });
    const { result } = renderHook(() => useQueryBlock());
    await act(async () => {
      await result.current.execute("source: tasks");
    });

    expect(getVaultTasks).not.toHaveBeenCalled();
    // 문구가 아니라 센티널이다 — 번역은 뷰가 한다.
    expect(result.current.error).toBe("tasks-disabled");
  });

  it("볼트가 없으면 센티널을 올린다", async () => {
    useFileStore.setState({ rootPath: null });
    const { result } = renderHook(() => useQueryBlock());
    await act(async () => {
      await result.current.execute("source: tasks");
    });

    await waitFor(() => expect(result.current.error).toBe("no-vault"));
  });
});
