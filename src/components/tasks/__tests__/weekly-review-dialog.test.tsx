// §315 주간 리뷰의 사용자 계약 — 아젠다와 **다른 점**만 본다.
//
// 묶음 분류는 `task-review.test.ts`가, 네 조작의 쓰기 경로는 정리 테스트들이 이미
// 고정한다. 여기서 지키는 것은 이 화면이 존재하는 이유 셋이다: 세 묶음이 한 흐름으로
// 이어지는 이동, 조작 후 자동 전진, 그리고 스캔 범위와 무관한 배수구(§312.1의 빚).
import type { TaskEntry } from "../../../ipc/types";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getVaultTasks = vi.fn().mockResolvedValue([]);
const getFileTasks = vi.fn().mockResolvedValue([]);

// `getConfig`/`setConfig`는 컨텍스트 스토어의 persist 미들웨어가 쓴다 — 이 화면이
// 그것을 읽지는 않지만, 이름이 빠지면 스토어 import 자체가 깨진다.
vi.mock("../../../ipc/invoke", () => ({
  appendTaskLine: vi.fn(),
  getConfig: vi.fn().mockResolvedValue(null),
  setConfig: vi.fn().mockResolvedValue(undefined),
  archiveTaskLines: vi.fn(),
  deleteTaskLine: vi.fn(),
  getFileTasks: (...a: unknown[]) => getFileTasks(...a),
  getVaultTasks: (...a: unknown[]) => getVaultTasks(...a),
  listDir: vi.fn().mockResolvedValue([]),
  previewTaskFieldLine: vi.fn(),
  previewTaskStateLine: vi.fn(),
  previewTaskTagLine: vi.fn(),
  readFile: vi.fn().mockResolvedValue(""),
  setTaskField: vi.fn(),
  setTaskState: vi.fn().mockResolvedValue("- [x] x"),
  setTaskTag: vi.fn().mockResolvedValue("- [ ] x #someday"),
}));

vi.mock("../../../utils/confirm-dialog", () => ({
  showAlert: vi.fn().mockResolvedValue(undefined),
  showConfirm: vi.fn().mockResolvedValue(true),
}));

import { useContextStore } from "../../../stores/context/context";
import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { useTaskStore } from "../../../stores/tasks/task-store";
import { useUIStore } from "../../../stores/ui/ui";
import { WeeklyReviewDialog } from "../WeeklyReviewDialog";

const HOME = "/home";

beforeEach(() => {
  vi.clearAllMocks();
  getVaultTasks.mockResolvedValue([]);
  getFileTasks.mockResolvedValue([]);
  useTaskStore.getState().clear();
  useFileStore.setState({ rootPath: "/vault" });
  useContextStore.setState({ contexts: [] });
  useSettingsStore.setState({
    locale: "en",
    tasksArchiveAfterDays: 30,
    tasksExcludePaths: [],
    tasksHome: HOME,
    // ‼️ 기본 범위다. 아젠다에서는 이 범위에서 배수구가 **보이지 않는다** — 리뷰가
    // 그것을 제공한다는 것이 §312.1이 남긴 약속이고, 아래 테스트가 그것을 고정한다.
    tasksScanScope: "allVaults",
    tasksWeekStart: "monday",
    zettelkastenDirectory: "",
  });
  useUIStore.setState({ weeklyReviewOpen: true });
});

describe("WeeklyReviewDialog — §315", () => {
  it("닫혀 있으면 아무것도 그리지 않는다", () => {
    useUIStore.setState({ weeklyReviewOpen: false });
    render(<WeeklyReviewDialog />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("세 묶음을 훑는 순서대로 놓는다 — 회고가 맨 아래다", () => {
    seed([overdue("늦음"), noDate("예정 없음"), doneToday("끝냄")]);
    render(<WeeklyReviewDialog />);

    const titles = screen
      .getAllByRole("heading", { level: 4 })
      .map((h) => h.textContent);
    expect(titles[0]).toContain("Overdue");
    expect(titles[1]).toContain("No date");
    expect(titles[2]).toContain("Finished this week");
  });

  it("예정대로 가는 항목은 어느 묶음에도 없다", () => {
    seed([task({ due: "2999-01-01", text: "먼 미래" })]);
    render(<WeeklyReviewDialog />);
    expect(screen.queryByText("먼 미래")).toBeNull();
  });

  it("`#someday`는 큐에서 빠진다 — 미룬 것이 남으면 s가 아무 일도 안 한 것처럼 보인다", () => {
    seed([noDate("미룸", { tags: ["someday"] }), noDate("남음")]);
    render(<WeeklyReviewDialog />);
    expect(screen.queryByText("미룸")).toBeNull();
    expect(screen.getByText("남음")).toBeInTheDocument();
  });

  it("열자마자 첫 행에 포커스가 간다 — 첫 조작이 마우스 클릭이면 안 된다", async () => {
    // 커맨드 팔레트로 열면 포커스가 이 화면 밖에 있다. 그대로 두면 `j`도 `x`도 Escape도
    // 닿지 않아, 키보드로 훑는 화면의 목적이 첫걸음부터 사라진다.
    seed([overdue("첫째"), noDate("둘째")]);
    render(<WeeklyReviewDialog />);

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getAllByRole("listitem")[0]),
    );
  });

  it("처리할 것이 없어도 Escape가 닿는다 — 다이얼로그가 포커스를 받는다", async () => {
    seed([]);
    render(<WeeklyReviewDialog />);

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("dialog")),
    );
    await userEvent.keyboard("{Escape}");
    expect(useUIStore.getState().weeklyReviewOpen).toBe(false);
  });

  it("j는 묶음 경계를 넘는다 — 아젠다는 여기서 멈춘다", async () => {
    // 이 화면이 아젠다와 다른 두 가지 중 하나다. 경계에서 멈추면 세 묶음을 한 흐름으로
    // 훑는다는 전제가 깨지고, 사용자는 묶음마다 마우스로 다시 진입해야 한다.
    seed([overdue("첫째"), noDate("둘째")]);
    render(<WeeklyReviewDialog />);

    const rows = screen.getAllByRole("listitem");
    rows[0].focus();
    await userEvent.keyboard("j");

    expect(document.activeElement).toBe(rows[1]);
  });

  it("k도 경계를 거슬러 올라간다", async () => {
    seed([overdue("첫째"), noDate("둘째")]);
    render(<WeeklyReviewDialog />);

    const rows = screen.getAllByRole("listitem");
    rows[1].focus();
    await userEvent.keyboard("k");

    expect(document.activeElement).toBe(rows[0]);
  });

  it("처리하면 그 자리에 온 다음 항목으로 포커스가 이어진다", async () => {
    // 자동 전진. 처리한 항목이 목록에서 빠지므로 **같은 인덱스**가 다음 항목이다 —
    // 이것이 없으면 조작마다 포커스가 body로 떨어져 다음 `j`가 아무 데도 닿지 않는다.
    seedTwoFiles();
    render(<WeeklyReviewDialog />);

    const rows = screen.getAllByRole("listitem");
    rows[0].focus();
    // `s` = #someday. 쓰기 뒤 그 파일만 다시 읽고, 돌아온 줄에는 태그가 붙어 있어
    // 큐에서 빠진다(`applyTaskFilters`).
    await userEvent.keyboard("s");

    await waitFor(() => {
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
    });
    expect(document.activeElement).toBe(screen.getAllByRole("listitem")[0]);
  });

  it("진행 상황은 남은 수가 줄어드는 것으로 보인다", async () => {
    seedTwoFiles();
    render(<WeeklyReviewDialog />);
    expect(screen.getByText("0 handled · 2 to go")).toBeInTheDocument();

    screen.getAllByRole("listitem")[0].focus();
    await userEvent.keyboard("s");

    await waitFor(() =>
      expect(screen.getByText("1 handled · 1 to go")).toBeInTheDocument(),
    );
  });

  it("처리할 것이 없으면 그 사실을 말한다 — 빈 화면으로 두지 않는다", () => {
    seed([doneToday("이번 주에 끝냄")]);
    render(<WeeklyReviewDialog />);
    expect(screen.getByText(/Nothing left to sort/)).toBeInTheDocument();
  });

  it("스캔 범위가 '전체'여도 배수구가 있다 — §312.1이 남긴 빚", async () => {
    // 아젠다의 배수구는 범위가 "태스크 홈"일 때만 나타난다. 기본 범위를 한 번도 바꾸지
    // 않는 사용자는 그것을 만나지 못하는데, 수집함이 단조 증가하지 않게 하는 장치가
    // 바로 그것이다 — 그래서 이 화면은 범위와 무관하게 제공한다.
    seed([noDate("아무거나")]);
    render(<WeeklyReviewDialog />);

    await waitFor(() =>
      expect(screen.getByText("Nothing to archive")).toBeInTheDocument(),
    );
  });

  it("긴 사유는 버튼이 아니라 title이 갖는다 — 두 줄로 감기면 푸터가 무너진다", async () => {
    seed([noDate("아무거나")]);
    render(<WeeklyReviewDialog />);

    const button = await screen.findByText("Nothing to archive");
    expect(button.closest("button")).toHaveAttribute(
      "title",
      expect.stringContaining("older than"),
    );
  });

  it("푸터의 두 덩어리가 같은 축으로 읽힌다", () => {
    // 버튼의 기본 정렬은 가운데다. 라벨이 두 줄로 감기면 왼쪽 버튼만 가운데 정렬이고
    // 오른쪽 힌트는 왼쪽 정렬인 상태가 되어 서로 다른 축으로 읽힌다(사용자 보고).
    // jsdom에는 레이아웃이 없으므로 규칙 자체를 읽는다.
    const css = readFileSync(
      join(process.cwd(), "src/styles/tasks.css"),
      "utf8",
    );
    const rule = /\.weekly-review-archive\s*\{([^}]*)\}/.exec(css)?.[1];
    expect(rule, "no .weekly-review-archive rule").toBeDefined();
    expect(rule).toMatch(/text-align:\s*left/);
    // 늘어나면 라벨이 짧아도 푸터가 다시 한쪽으로 쏠린다.
    expect(rule).toMatch(/flex-shrink:\s*0/);
  });

  it("범위 밖에 쌓인 완료 항목도 배수구가 센다", async () => {
    // 여기가 이 화면이 §312.1의 빚을 실제로 갚는 지점이다. 범위를 "현재 볼트"로 좁혀 두면
    // 태스크 홈이 스토어에 없다 — 그래도 정리할 것이 몇 개인지 말할 수 있어야 한다.
    useSettingsStore.setState({ tasksScanScope: "currentVault" });
    seed([]);
    seedHome([archivable()]);
    render(<WeeklyReviewDialog />);

    await waitFor(() =>
      expect(screen.getByText(/Archive 1 completed/)).toBeInTheDocument(),
    );
  });

  it("배수구는 **태스크 홈**을 따로 걷는다 — 스토어가 아니라", async () => {
    // 범위를 좁혀 두면 홈이 스캔 대상에 없을 수 있다. 스토어만 보면 파일에 정리할 것이
    // 쌓여 있는데도 대상이 0으로 보인다.
    useSettingsStore.setState({ tasksScanScope: "currentVault" });
    seed([]);
    render(<WeeklyReviewDialog />);

    await waitFor(() => expect(getVaultTasks).toHaveBeenCalledWith(HOME, []));
  });

  it("Escape로 닫는다", async () => {
    seed([noDate("아무거나")]);
    render(<WeeklyReviewDialog />);

    screen.getAllByRole("listitem")[0].focus();
    await userEvent.keyboard("{Escape}");

    expect(useUIStore.getState().weeklyReviewOpen).toBe(false);
  });
});

function doneToday(text: string): TaskEntry {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const iso = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return task({ done: iso, state: "done", text });
}

function noDate(text: string, over: Partial<TaskEntry> = {}): TaskEntry {
  return task({ text, ...over });
}

function overdue(text: string): TaskEntry {
  return task({ due: "2000-01-01", text });
}

/**
 * ‼️ 스토어와 **목 둘 다** 세운다. 이 화면은 열릴 때 지금 범위를 한 번 걷는데(커맨드
 * 팔레트로 바로 열면 스토어가 비어 있을 수 있어서다), 목이 빈 배열을 돌려주면 그 스캔이
 * 방금 심은 목록을 지운다 — 아젠다 테스트가 같은 함정에 한 번 빠졌다.
 */
function seed(tasks: TaskEntry[]): void {
  getVaultTasks.mockResolvedValue(tasks);
  useTaskStore.getState().setAll(tasks);
}

/** 문턱을 넘긴 완료 태스크 — 수집함 안이라 §312 화이트리스트에 든다. */
function archivable(): TaskEntry {
  return task({
    done: "2020-01-01",
    path: `${HOME}/tasks/inbox.md`,
    raw: "- [x] 오래된 완료 ✅2020-01-01",
    state: "done",
    text: "오래된 완료",
  });
}

/** 태스크 홈 스캔에만 답한다 — 아젠다 범위 스캔은 그대로 비워 둔다. */
function seedHome(tasks: TaskEntry[]): void {
  getVaultTasks.mockImplementation((root: string) =>
    Promise.resolve(root === HOME ? tasks : []),
  );
}

/**
 * 두 항목을 **서로 다른 파일**에 심는다. 정리 조작은 그 파일 하나만 다시 읽어 통째로
 * 갈아끼우므로(`replaceFile`), 한 파일에 둘을 두면 하나를 처리했을 때 나머지까지 사라져
 * 자동 전진이 검증하려던 상황 자체가 만들어지지 않는다.
 */
function seedTwoFiles(): void {
  const first = noDate("첫째", { path: `${HOME}/tasks/a.md` });
  const second = noDate("둘째", { path: `${HOME}/tasks/b.md` });
  seed([first, second]);
  // `s` 뒤의 재스캔 — 돌아온 줄에 태그가 붙어 있어야 그 항목이 큐에서 빠진다.
  getFileTasks.mockResolvedValue([{ ...first, tags: ["someday"] }]);
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
    path: `${HOME}/tasks/inbox.md`,
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
