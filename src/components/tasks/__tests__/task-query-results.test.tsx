// §310 쿼리 블록이 그리는 태스크 결과 — 문서 **안에서** 처리할 수 있어야 한다.
//
// 무엇이 결과가 되는지는 `task-query.test.ts`가 순수 함수로 고정한다. 여기서 보는 것은
// 세 표시 모드와, 목록이 읽기 전용이 아니라는 것.
import type { TaskEntry } from "../../../ipc/types";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setTaskState = vi.fn().mockResolvedValue("- [x] 하나");
const onChanged = vi.fn();

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
    timer: null,
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
    render(
      <TaskQueryResults
        display="list"
        now={NOW}
        onChanged={onChanged}
        tasks={[task()]}
      />,
    );

    expect(screen.getByRole("button", { name: /하나 — / })).toBeInTheDocument();
  });

  it("체크가 아젠다와 같은 쓰기 경로를 탄다", async () => {
    render(
      <TaskQueryResults
        display="list"
        now={NOW}
        onChanged={onChanged}
        tasks={[task()]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /하나 — / }));

    expect(setTaskState).toHaveBeenCalledWith(
      "projects/alpha.md",
      0,
      "- [ ] 하나",
      // §18.18 M4 — 한 번 누르면 고리를 한 걸음 돈다(할 일 → 진행 중).
      "doing",
      true,
      "2026-08-30",
      // §18.18 M4 — 시간 기록이 꺼져 있으면 `⏱`를 건드리지 말라는 뜻이다.
      null,
    );
  });

  it("‼️ 쓰기가 착지하면 블록에 다시 돌리라고 알린다", async () => {
    // 이 표면은 스토어를 구독하지 않는다 — 결과는 블록이 한 번 걷어 온 로컬 state다.
    // 이 신호가 없으면 디스크에는 써졌는데 제어 체크박스는 다음 렌더에서 원래대로
    // 돌아가고, 사용자는 "체크가 안 먹었다"로 읽는다(파일은 이미 바뀌어 있다).
    render(
      <TaskQueryResults
        display="list"
        now={NOW}
        onChanged={onChanged}
        tasks={[task()]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /하나 — / }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("‼️ 쓰기가 실패해도 알린다 — 그때 재스캔이 도니까", async () => {
    // 실패 경로는 그 파일을 다시 읽어 스토어를 고친다(stale 자가 교정). 그 재스캔이
    // 드러낸 사실을 이 표면만 모른 채 두면, 실패 뒤의 화면이 재스캔 **전**의 상태다.
    setTaskState.mockRejectedValueOnce("Permission denied (os error 13)");
    render(
      <TaskQueryResults
        display="list"
        now={NOW}
        onChanged={onChanged}
        tasks={[task()]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /하나 — / }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("table은 태스크 열로 그린다 — 파일 열이 아니라", () => {
    render(
      <TaskQueryResults
        display="table"
        now={NOW}
        onChanged={onChanged}
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
        onChanged={onChanged}
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
        onChanged={onChanged}
        tasks={[task({ text: "[[202607051530]] 정리" })]}
      />,
    );

    expect(screen.getByText("원자적 노트 정리")).toBeInTheDocument();
  });
});
