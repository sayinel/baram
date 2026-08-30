// §310 쿼리 블록이 그리는 태스크 결과 — 문서 **안에서** 처리할 수 있어야 한다.
//
// 무엇이 결과가 되는지는 `task-query.test.ts`가 순수 함수로 고정한다. 여기서 보는 것은
// 세 표시 모드와, 목록이 읽기 전용이 아니라는 것.
import type { TaskEntry } from "../../../ipc/types";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setTaskState = vi.fn().mockResolvedValue("- [x] 하나");

vi.mock("../../../ipc/invoke", () => ({
  appendTaskLine: vi.fn(),
  archiveTaskLines: vi.fn(),
  getFileTasks: vi.fn().mockResolvedValue([]),
  getVaultTasks: vi.fn().mockResolvedValue([]),
  listDir: vi.fn().mockResolvedValue([]),
  previewTaskStateLine: vi.fn(),
  readFile: vi.fn().mockResolvedValue(""),
  setTaskState: (...a: unknown[]) => setTaskState(...a),
}));

vi.mock("../../../pipeline", () => ({
  prosemirrorToMarkdown: vi.fn(),
}));

import { useSettingsStore } from "../../../stores/settings/store";
import { useZettelIndexStore } from "../../../stores/zettelkasten/zettel-index";
import { TaskQueryResults } from "../TaskQueryResults";

const NOW = new Date(2026, 7, 30);

function task(over: Partial<TaskEntry> = {}): TaskEntry {
  return {
    cancelled: null,
    created: null,
    done: null,
    due: null,
    indent: 0,
    line: 0,
    links: [],
    path: "projects/alpha.md",
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

beforeEach(() => {
  vi.clearAllMocks();
  useZettelIndexStore.getState().clear();
  useSettingsStore.setState({
    locale: "en",
    tasksExcludePaths: [],
    tasksRecordDoneDate: true,
  });
});

describe("TaskQueryResults", () => {
  it("‼️ list는 읽기 전용이 아니다 — 문서 안에서 체크된다", () => {
    // 설계 §18.13이 못박은 자리다. 읽기만 되는 목록은 링크 모음과 다르지 않고, MOC이
    // 프로젝트 **보드**가 되는 것은 그 자리에서 처리할 수 있기 때문이다.
    render(<TaskQueryResults display="list" now={NOW} tasks={[task()]} />);

    expect(screen.getByRole("checkbox", { name: /하나/ })).toBeInTheDocument();
  });

  it("체크가 아젠다와 같은 쓰기 경로를 탄다", async () => {
    render(<TaskQueryResults display="list" now={NOW} tasks={[task()]} />);

    await userEvent.click(screen.getByRole("checkbox", { name: /하나/ }));

    expect(setTaskState).toHaveBeenCalledWith(
      "projects/alpha.md",
      0,
      "- [ ] 하나",
      "done",
      true,
      "2026-08-30",
    );
  });

  it("table은 태스크 열로 그린다 — 파일 열이 아니라", () => {
    render(
      <TaskQueryResults
        display="table"
        now={NOW}
        tasks={[task({ due: "2026-09-01", priority: 2 })]}
      />,
    );

    expect(
      screen.getByRole("columnheader", { name: "Due" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2026-09-01")).toBeInTheDocument();
    expect(screen.getByText("Urgent priority")).toBeInTheDocument();
  });

  it("card는 본문을 제목으로, 파일을 부제로 쓴다", () => {
    render(
      <TaskQueryResults
        display="card"
        now={NOW}
        tasks={[task({ tags: ["work"] })]}
      />,
    );

    expect(screen.getByText("하나")).toBeInTheDocument();
    expect(screen.getByText("projects/alpha.md")).toBeInTheDocument();
    expect(screen.getByText("#work")).toBeInTheDocument();
  });

  it("본문의 링크는 노트 제목으로 보인다", () => {
    // 아젠다·노트 섹션과 같은 표시 규칙(`displayText`) — 세 화면이 같은 줄을 다르게
    // 보이면 사용자는 그것을 다른 태스크로 읽는다.
    useZettelIndexStore
      .getState()
      .setAll([{ id: "202607051530", path: "/v/n.md", title: "원자적 노트" }]);
    render(
      <TaskQueryResults
        display="list"
        now={NOW}
        tasks={[task({ text: "[[202607051530]] 정리" })]}
      />,
    );

    expect(screen.getByText("원자적 노트 정리")).toBeInTheDocument();
  });
});
