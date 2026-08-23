import type { TaskEntry } from "../../../ipc/types";

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setTaskState = vi.fn().mockResolvedValue("- [x] 하나");
const getVaultTasks = vi.fn().mockResolvedValue([]);
const getFileTasks = vi.fn().mockResolvedValue([]);

// listDir/readFile 스텁이 필요한 이유: TaskAgendaPanel → useZettelIndexStore →
// 같은 모듈에서 listDir/readFile을 import한다. 3개만 목하면 그 import가 깨진다.
vi.mock("../../../ipc/invoke", () => ({
  getFileTasks: (...a: unknown[]) => getFileTasks(...a),
  getVaultTasks: (...a: unknown[]) => getVaultTasks(...a),
  listDir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(""),
  setTaskState: (...a: unknown[]) => setTaskState(...a),
}));

import { useTaskStore } from "../../../stores/tasks/task-store";
import { useUIStore } from "../../../stores/ui/ui";
import { TaskAgendaPanel } from "../TaskAgendaPanel";

function task(over: Partial<TaskEntry> = {}): TaskEntry {
  return {
    cancelled: null,
    created: null,
    done: null,
    due: null,
    indent: 0,
    line: 0,
    links: [],
    path: "a.md",
    priority: 0,
    raw: "- [ ] 하나",
    recurrence: null,
    scheduled: null,
    start: null,
    state: "todo",
    tags: [],
    text: "하나",
    ...over,
  };
}

describe("TaskAgendaPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTaskStore.getState().clear();
    useUIStore.getState().dismissToast();
  });

  it("renders a bucket heading with its count", () => {
    useTaskStore.getState().setAll([task({ due: "2000-01-01" })]);
    render(<TaskAgendaPanel />);
    expect(screen.getByText(/Overdue/)).toBeInTheDocument();
    expect(screen.getByText("하나")).toBeInTheDocument();
  });

  it("hides an empty bucket", () => {
    useTaskStore.getState().setAll([]);
    render(<TaskAgendaPanel />);
    expect(screen.queryByText(/Overdue/)).not.toBeInTheDocument();
  });

  it("sends expectedRaw when a checkbox is clicked", async () => {
    useTaskStore.getState().setAll([task({ raw: "- [ ] 하나" })]);
    render(<TaskAgendaPanel />);

    await userEvent.click(screen.getByRole("checkbox", { name: /하나/ }));

    expect(setTaskState).toHaveBeenCalledWith(
      "a.md",
      0,
      "- [ ] 하나",
      "done",
      true,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it("silently re-scans the file when the write comes back stale", async () => {
    // I1: rootPath/exclude가 증분 재스캔에도 실려야 exclude 설정이 지켜진다 —
    // rootPath가 없는 이 렌더에서는 null/[]로 넘어간다.
    setTaskState.mockRejectedValueOnce("stale");
    useTaskStore.getState().setAll([task()]);
    render(<TaskAgendaPanel />);

    await userEvent.click(screen.getByRole("checkbox", { name: /하나/ }));

    expect(getFileTasks).toHaveBeenCalledWith("a.md", null, []);
    expect(useUIStore.getState().toast).toBeNull();
  });

  it("shows a toast for a non-stale write failure but still re-scans (I5)", async () => {
    setTaskState.mockRejectedValueOnce("Permission denied (os error 13)");
    useTaskStore.getState().setAll([task()]);
    render(<TaskAgendaPanel />);

    await userEvent.click(screen.getByRole("checkbox", { name: /하나/ }));

    expect(useUIStore.getState().toast?.type).toBe("error");
    expect(getFileTasks).toHaveBeenCalledWith("a.md", null, []);
  });

  it("re-scans exactly once per toggle regardless of outcome (I5)", async () => {
    setTaskState.mockRejectedValueOnce("stale");
    useTaskStore.getState().setAll([task()]);
    render(<TaskAgendaPanel />);

    await userEvent.click(screen.getByRole("checkbox", { name: /하나/ }));

    expect(getFileTasks).toHaveBeenCalledTimes(1);
  });

  describe("midnight rollover (I4)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("moves a task from Later into Today once the local clock crosses midnight", async () => {
      // 2026-08-23는 일요일이므로(주 시작 월요일 기준) 다음날은 이번 주 밖 —
      // "하나"는 자정 전엔 Later, 자정을 넘기면 Today로 옮겨가야 한다.
      vi.setSystemTime(new Date(2026, 7, 23, 23, 59, 0));
      useTaskStore.getState().setAll([task({ due: "2026-08-24" })]);
      render(<TaskAgendaPanel />);

      expect(screen.getByText(/Later/)).toBeInTheDocument();
      expect(screen.queryByText(/Today/)).not.toBeInTheDocument();

      await act(() => vi.advanceTimersByTimeAsync(2 * 60 * 1000));

      expect(screen.getByText(/Today/)).toBeInTheDocument();
      expect(screen.queryByText(/Later/)).not.toBeInTheDocument();
    });

    it("writes the done date using the boundary the user is looking at, not a live clock", async () => {
      // 자정을 넘긴 뒤에도 롤오버 타이머가 아직 안 돌았다면(=아직 리렌더 전),
      // 화면의 버킷 경계와 디스크에 적히는 ✅ 날짜가 같은 날이어야 한다.
      vi.setSystemTime(new Date(2026, 7, 23, 23, 59, 0));
      useTaskStore.getState().setAll([task({ raw: "- [ ] 하나" })]);
      render(<TaskAgendaPanel />);

      vi.setSystemTime(new Date(2026, 7, 24, 0, 0, 30));
      // userEvent는 내부적으로 실시간 delay에 의존해 fake timers와 함께 걸리므로
      // 여기서는 fireEvent로 클릭만 합성한다.
      fireEvent.click(screen.getByRole("checkbox", { name: /하나/ }));

      expect(setTaskState).toHaveBeenCalledWith(
        "a.md",
        0,
        "- [ ] 하나",
        "done",
        true,
        "2026-08-23",
      );
    });
  });
});
