import type { TaskEntry } from "../../../ipc/types";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    setTaskState.mockRejectedValueOnce("stale");
    useTaskStore.getState().setAll([task()]);
    render(<TaskAgendaPanel />);

    await userEvent.click(screen.getByRole("checkbox", { name: /하나/ }));

    expect(getFileTasks).toHaveBeenCalledWith("a.md");
  });
});
