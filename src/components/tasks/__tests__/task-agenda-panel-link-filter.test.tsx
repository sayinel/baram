// §306 링크 대상 필터 — 아젠다를 한 프로젝트에 고정한다.
//
// 판정 자체는 `task-filters.test.ts`가 고정한다. 여기서 보는 것은 배선이다: 옵션이
// 어디서 오는가, 무엇으로 이름 붙는가, 고른 대상이 사라지면 어떻게 되는가.
import type { TaskEntry } from "../../../ipc/types";

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { useZettelIndexStore } from "../../../stores/zettelkasten/zettel-index";
import { TaskAgendaPanel } from "../TaskAgendaPanel";

function seed(tasks: TaskEntry[]) {
  getVaultTasks.mockResolvedValue(tasks);
  useTaskStore.getState().setAll(tasks);
}

function task(over: Partial<TaskEntry> = {}): TaskEntry {
  return {
    cancelled: null,
    created: null,
    done: null,
    due: "2026-08-30",
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
  vi.clearAllMocks();
  useTaskStore.getState().clear();
  useFileStore.setState({ rootPath: "/v" });
  useContextStore.setState({ contexts: [] });
  useZettelIndexStore.getState().setAll([
    {
      id: "202607051530",
      path: "/v/notes/202607051530 원자적 노트.md",
      title: "원자적 노트",
    },
  ]);
  useSettingsStore.setState({
    locale: "en",
    tasksEnabled: true,
    tasksExcludePaths: [],
    tasksScanScope: "currentVault",
    tasksWeekStart: "monday",
  });
});

describe("§306 링크 대상 필터", () => {
  it("링크가 하나도 없으면 필터 자체가 없다", () => {
    // 고를 것이 없는 <select>는 화면 폭만 먹는다 — 태그 필터와 같은 규칙이다.
    seed([task({ links: [] })]);
    render(<TaskAgendaPanel />);

    expect(
      screen.queryByLabelText("Filter by linked note"),
    ).not.toBeInTheDocument();
  });

  it("‼️ 옵션 이름은 ID가 아니라 노트 제목이다", () => {
    // 저장된 값은 `202607051530`이다. 그대로 늘어놓으면 어느 것이 무엇인지 고를 수 없다.
    seed([task({ links: ["202607051530"] })]);
    render(<TaskAgendaPanel />);

    expect(
      screen.getByRole("option", { name: "원자적 노트" }),
    ).toBeInTheDocument();
  });

  it("고른 대상을 가리키는 태스크만 남는다", async () => {
    seed([
      task({ links: ["202607051530"], text: "이 프로젝트" }),
      task({ line: 1, links: ["202607051531"], text: "다른 프로젝트" }),
    ]);
    render(<TaskAgendaPanel />);

    await userEvent.selectOptions(
      screen.getByLabelText("Filter by linked note"),
      "202607051530",
    );

    expect(screen.getByText("이 프로젝트")).toBeInTheDocument();
    expect(screen.queryByText("다른 프로젝트")).not.toBeInTheDocument();
  });

  it("‼️ 하나를 고른 뒤에도 다른 대상으로 바꿀 수 있다", () => {
    // 옵션을 **걸러낸 목록**에서 뽑으면 고르는 순간 그 대상 하나만 남아, 필터를 바꾸는
    // 유일한 길이 "전체로 되돌리기"가 된다. 태그 필터가 같은 이유로 필터 적용 전에서
    // 뽑는다(I2).
    seed([
      task({ links: ["202607051530"], text: "이 프로젝트" }),
      task({ line: 1, links: ["202607051531"], text: "다른 프로젝트" }),
    ]);
    render(<TaskAgendaPanel />);
    const select = screen.getByLabelText("Filter by linked note");
    expect(select.querySelectorAll("option")).toHaveLength(3); // 전체 + 둘

    fireEvent.change(select, { target: { value: "202607051530" } });

    expect(screen.queryByText("다른 프로젝트")).not.toBeInTheDocument();
    expect(select.querySelectorAll("option")).toHaveLength(3);
  });

  it("고른 대상이 사라지면 '전체'로 되돌아간다", async () => {
    seed([
      task({ links: ["202607051530"], text: "이 프로젝트" }),
      task({ line: 1, links: ["202607051531"], text: "다른 프로젝트" }),
    ]);
    const { rerender } = render(<TaskAgendaPanel />);
    await userEvent.selectOptions(
      screen.getByLabelText("Filter by linked note"),
      "202607051530",
    );
    expect(screen.queryByText("다른 프로젝트")).not.toBeInTheDocument();

    // 그 태스크가 지워졌다(체크·삭제·범위 축소). 필터가 그 값으로 걸린 채 남으면
    // <select>는 빈 선택으로 보이는데 목록은 계속 걸러진다.
    seed([task({ line: 1, links: ["202607051531"], text: "다른 프로젝트" })]);
    rerender(<TaskAgendaPanel />);

    expect(screen.getByText("다른 프로젝트")).toBeInTheDocument();
  });
});
