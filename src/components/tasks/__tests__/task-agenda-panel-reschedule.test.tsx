// §309 "기한 초과 전부 오늘로" 확인 게이트 — 사용자가 취소하면 파일을 단 하나도
// 건드리지 않아야 한다. 이 파일에서만 `applyTaskWrite`를 통째로 모킹해 실제
// IPC 라우팅과 무관하게 "그 함수에 도달했는가"만 직접 검증한다(기존
// task-agenda-panel.test.tsx는 실제 apply-task-write 라우팅을 검증하므로 거기
// 섞으면 그 스위트의 의도가 흐려진다).
import type { TaskEntry } from "../../../ipc/types";

import { render, screen } from "@testing-library/react";
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

import { useTaskStore } from "../../../stores/tasks/task-store";
import { showConfirm } from "../../../utils/confirm-dialog";
import { applyTaskWrite } from "../../../utils/tasks/apply-task-write";
import { TaskAgendaPanel } from "../TaskAgendaPanel";

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

  it("확인하면 실제로 쓴다 — 취소 테스트가 트리비얼하게 통과하지 않도록 대칭으로 검증", async () => {
    vi.mocked(showConfirm).mockResolvedValue(true);
    vi.mocked(applyTaskWrite).mockResolvedValue({ kind: "disk", raw: "" });
    useTaskStore.getState().setAll([task()]);
    render(<TaskAgendaPanel />);

    await userEvent.click(screen.getByTitle(/Reschedule/));

    expect(applyTaskWrite).toHaveBeenCalled();
  });
});
