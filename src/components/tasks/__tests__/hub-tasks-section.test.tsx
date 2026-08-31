// §307 C 허브의 태스크 섹션 — 지금 손대야 하는 것만, 일곱 줄까지.
import type { TaskEntry } from "../../../ipc/types";

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getVaultTasks = vi.fn().mockResolvedValue([]);

vi.mock("../../../ipc/invoke", () => ({
  appendTaskLine: vi.fn(),
  archiveTaskLines: vi.fn(),
  getFileTasks: vi.fn().mockResolvedValue([]),
  getVaultTasks: (...a: unknown[]) => getVaultTasks(...a),
  listDir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(""),
}));

import { useContextStore } from "../../../stores/context/context";
import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { useTaskStore } from "../../../stores/tasks/task-store";
import { useUIStore } from "../../../stores/ui/ui";
import { HubTasksSection } from "../HubTasksSection";

// 2026-08-30은 일요일이다. 아래 날짜들은 이 날을 기준으로 고른다.
const TODAY = "2026-08-30";

function seed(tasks: TaskEntry[]) {
  getVaultTasks.mockResolvedValue(tasks);
  useTaskStore.getState().setAll(tasks);
}

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
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 30, 12, 0, 0));
  vi.clearAllMocks();
  useTaskStore.getState().clear();
  useFileStore.setState({ rootPath: "/v" });
  useContextStore.setState({ contexts: [] });
  useSettingsStore.setState({
    locale: "en",
    tasksEnabled: true,
    tasksExcludePaths: [],
    tasksScanScope: "currentVault",
    tasksWeekStart: "monday",
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("HubTasksSection", () => {
  it("기한 초과·예정 밀림·오늘만 보인다", () => {
    seed([
      task({ due: "2026-08-01", text: "기한 초과" }),
      task({ line: 1, scheduled: "2026-08-01", text: "예정 밀림" }),
      task({ due: TODAY, line: 2, text: "오늘" }),
      task({ due: "2026-12-01", line: 3, text: "나중" }),
      task({ line: 4, text: "예정 없음" }),
    ]);
    render(<HubTasksSection />);

    expect(screen.getByText("기한 초과")).toBeInTheDocument();
    expect(screen.getByText("오늘")).toBeInTheDocument();
    expect(screen.queryByText("나중")).not.toBeInTheDocument();
    expect(screen.queryByText("예정 없음")).not.toBeInTheDocument();
  });

  it("‼️ 예정 밀림을 빼지 않는다", () => {
    // 설계 §18.6 C는 이 버킷이 생기기 전에 쓰였다. 빼면 기한 없이 `⏳`만 쓰는 사용자에게
    // 이 섹션이 영영 비어 있다 — 아젠다에는 밀린 것이 쌓여 있는데 허브는 할 일이 없다고
    // 말하는 상태다.
    seed([task({ scheduled: "2026-08-01", text: "예정 밀림" })]);
    render(<HubTasksSection />);

    expect(screen.getByText("예정 밀림")).toBeInTheDocument();
    expect(screen.getByText("TASKS (1)")).toBeInTheDocument();
  });

  it("일곱 줄까지만 그리고, 넘으면 나머지 개수를 말한다", () => {
    seed(
      Array.from({ length: 10 }, (_, i) =>
        task({ due: TODAY, line: i, text: `할 일 ${i}` }),
      ),
    );
    render(<HubTasksSection />);

    expect(screen.getAllByTitle(/Next state/)).toHaveLength(7);
    expect(screen.getByText("See all — 3 more")).toBeInTheDocument();
    // 머리 숫자는 자른 뒤가 아니라 **전체**다 — 7로 굳으면 그 위로는 늘어난 걸 알 수 없다.
    expect(screen.getByText("TASKS (10)")).toBeInTheDocument();
  });

  it("일곱 줄 이하면 '전체 보기'가 없다", () => {
    seed([task({ due: TODAY })]);
    render(<HubTasksSection />);

    expect(screen.queryByText(/See all/)).not.toBeInTheDocument();
  });

  it("'전체 보기'는 아젠다 패널을 연다", () => {
    seed(
      Array.from({ length: 8 }, (_, i) =>
        task({ due: TODAY, line: i, text: `할 일 ${i}` }),
      ),
    );
    useUIStore.getState().setSidebarPanel("zettel");
    render(<HubTasksSection />);

    fireEvent.click(screen.getByText("See all — 1 more"));

    expect(useUIStore.getState().sidebarPanel).toBe("tasks");
  });

  it("비어 있으면 그렇게 말한다", () => {
    seed([task({ due: "2026-12-01" })]);
    render(<HubTasksSection />);

    expect(screen.getByText(/Nothing overdue/)).toBeInTheDocument();
  });

  it("‼️ 태스크 기능이 꺼져 있으면 렌더도 스캔도 없다", () => {
    useSettingsStore.setState({ tasksEnabled: false });
    seed([task({ due: TODAY })]);
    const { container } = render(<HubTasksSection />);

    expect(container).toBeEmptyDOMElement();
    expect(getVaultTasks).not.toHaveBeenCalled();
  });

  it("헤더를 누르면 접힌다", () => {
    seed([task({ due: TODAY, text: "오늘 할 것" })]);
    render(<HubTasksSection />);
    expect(screen.getByText("오늘 할 것")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /TASKS/ }));

    expect(screen.queryByText("오늘 할 것")).not.toBeInTheDocument();
  });
});
