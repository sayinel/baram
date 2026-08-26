// §309 "기한 초과 전부 오늘로" 액션의 사용자 계약 — 확인 게이트, 전량 처리,
// 실행 중 재진입 차단, 결과 보고. 이 파일에서만 `applyTaskWrite`를 통째로
// 모킹해 실제 IPC 라우팅과 무관하게 패널 쪽 계약만 본다(실제 라우터에 대고
// 도는 배치는 task-bulk-actions-document.test.ts가, 라우팅 표 자체는
// apply-task-write.test.ts가 본다).
import type { TaskEntry } from "../../../ipc/types";
import type { TaskWriteResult } from "../../../utils/tasks/apply-task-write";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// listDir/readFile 스텁이 필요한 이유: TaskAgendaPanel → useZettelIndexStore →
// 같은 모듈에서 listDir/readFile을 import한다(task-agenda-panel.test.tsx와 동일 사유).
vi.mock("../../../ipc/invoke", () => ({
  getFileTasks: vi.fn().mockResolvedValue([]),
  getVaultTasks: vi.fn().mockResolvedValue([]),
  listDir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../../utils/confirm-dialog", () => ({
  showAlert: vi.fn().mockResolvedValue(undefined),
  showConfirm: vi.fn(),
}));

vi.mock("../../../utils/tasks/apply-task-write", () => ({
  applyTaskWrite: vi.fn(),
  applyToContent: vi.fn(),
  resolveTaskWriteTarget: vi.fn(() => ({ kind: "disk" })),
}));

import { getFileTasks } from "../../../ipc/invoke";
import { useTaskStore } from "../../../stores/tasks/task-store";
import { showAlert, showConfirm } from "../../../utils/confirm-dialog";
import { applyTaskWrite } from "../../../utils/tasks/apply-task-write";
import { TaskAgendaPanel } from "../TaskAgendaPanel";

const DISK: TaskWriteResult = { kind: "disk", raw: "" };
/** 패널이 `now`에서 계산해 넘기는 값과 같은 형태 — 인자 단언에 쓴다. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function task(over: Partial<TaskEntry> = {}): TaskEntry {
  return {
    cancelled: null,
    created: null,
    done: null,
    due: "2000-01-01",
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

beforeEach(() => {
  vi.clearAllMocks();
  useTaskStore.getState().clear();
});

describe("TaskAgendaPanel — reschedule overdue 확인 게이트 (§309)", () => {
  it("취소하면 applyTaskWrite에 아예 도달하지 않는다 — 카운트가 0인 게 아니라 호출 자체가 없어야 한다", async () => {
    vi.mocked(showConfirm).mockResolvedValue(false);
    useTaskStore.getState().setAll([task()]);
    render(<TaskAgendaPanel />);

    await userEvent.click(screen.getByTitle(/Reschedule/));

    expect(showConfirm).toHaveBeenCalled();
    expect(applyTaskWrite).not.toHaveBeenCalled();
  });

  it("확인 문구가 실제 기한 초과 개수를 담는다", async () => {
    vi.mocked(showConfirm).mockResolvedValue(false);
    useTaskStore
      .getState()
      .setAll([task({ line: 0 }), task({ line: 1 }), task({ line: 2 })]);
    render(<TaskAgendaPanel />);

    await userEvent.click(screen.getByTitle(/Reschedule/));

    expect(showConfirm).toHaveBeenCalledWith(
      "Reschedule 3 overdue task(s) to today?",
    );
  });

  it("확인하면 기한 초과 태스크를 **전부** 오늘 날짜로 재조정한다", async () => {
    // 횟수와 인자를 함께 본다 — `toHaveBeenCalled()`만 보면 N개 중 첫 하나만
    // 처리하는 회귀가 그대로 통과한다.
    vi.mocked(showConfirm).mockResolvedValue(true);
    vi.mocked(applyTaskWrite).mockResolvedValue(DISK);
    useTaskStore
      .getState()
      .setAll([
        task({ line: 0 }),
        task({ line: 1 }),
        task({ line: 0, path: "b.md" }),
      ]);
    render(<TaskAgendaPanel />);

    await userEvent.click(screen.getByTitle(/Reschedule/));

    await waitFor(() => expect(applyTaskWrite).toHaveBeenCalledTimes(3));
    for (const [path, line] of [
      ["a.md", 0],
      ["a.md", 1],
      ["b.md", 0],
    ] as const) {
      expect(applyTaskWrite).toHaveBeenCalledWith(
        expect.objectContaining({ line, path }),
        {
          field: "due",
          kind: "field",
          value: expect.stringMatching(ISO_DATE),
        },
        // EditorProvider가 없으므로 컨텍스트는 null — 라우터가 디스크로 폴백한다.
        null,
      );
    }
  });

  it("실행 중에는 버튼이 잠긴다 — 두 번째 루프가 겹쳐 돌면 문서 경로에서 배치끼리 덮어쓴다", async () => {
    vi.mocked(showConfirm).mockResolvedValue(true);
    let release!: () => void;
    vi.mocked(applyTaskWrite).mockImplementation(
      () =>
        new Promise<TaskWriteResult>((resolve) => {
          release = () => resolve(DISK);
        }),
    );
    // 실행이 끝나면 호출자가 그 파일을 다시 읽는다 — 빈 결과를 주면 버킷이
    // 비어 버튼이 언마운트되고 "잠금이 풀렸는가"를 물어볼 수 없게 된다.
    vi.mocked(getFileTasks).mockResolvedValue([task()]);
    useTaskStore.getState().setAll([task()]);
    render(<TaskAgendaPanel />);

    const button = screen.getByTitle(/Reschedule/);
    await userEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());

    await userEvent.click(button);
    expect(applyTaskWrite).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("실패가 있으면 경고를 띄운다", async () => {
    vi.mocked(showConfirm).mockResolvedValue(true);
    vi.mocked(applyTaskWrite).mockRejectedValue(new Error("permission denied"));
    useTaskStore.getState().setAll([task({ line: 0 }), task({ line: 1 })]);
    render(<TaskAgendaPanel />);

    await userEvent.click(screen.getByTitle(/Reschedule/));

    await waitFor(() =>
      expect(showAlert).toHaveBeenCalledWith(
        expect.stringContaining("Couldn't reschedule 2 task(s)"),
      ),
    );
  });

  it("전부 stale이어도 조용히 끝나지 않는다 — 그 실행은 확인까지 거치고 아무 일도 안 한 것처럼 보인다", async () => {
    vi.mocked(showConfirm).mockResolvedValue(true);
    vi.mocked(applyTaskWrite).mockResolvedValue({
      kind: "stale",
      target: "disk",
    });
    useTaskStore.getState().setAll([task({ line: 0 }), task({ line: 1 })]);
    render(<TaskAgendaPanel />);

    await userEvent.click(screen.getByTitle(/Reschedule/));

    // 오류가 아니라 정상 경합이므로 실패와 같은 문구로 뭉뚱그리지 않는다.
    await waitFor(() =>
      expect(showAlert).toHaveBeenCalledWith(
        "2 task(s) changed elsewhere and were skipped.",
      ),
    );
  });
});
