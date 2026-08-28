// §312 "완료 항목 정리" 액션의 사용자 계약 — 확인 게이트, 저장 전 탭 방어, 회계 보고.
//
// 이동 자체는 Rust가 하고 그쪽 단위 테스트(`task/archive.rs`)가 불가침 규칙과 "붙이기
// 먼저"를 고정한다. 여기서 보는 것은 **패널이 그 커맨드를 언제 부르고 무엇을 넘기고
// 결과를 어떻게 말하는가**뿐이다.
import type { ArchiveOutcome, TaskEntry } from "../../../ipc/types";
import type { EditorTab } from "../../../stores/editor/editor";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// listDir/readFile 스텁이 필요한 이유: TaskAgendaPanel → useZettelIndexStore →
// 같은 모듈에서 listDir/readFile을 import한다(task-agenda-panel.test.tsx와 동일 사유).
// appendTaskLine은 `task-capture`가 가져간다 — `resolveCapturePath`를 쓰려고 그 모듈을
// import하므로 이름이 하나라도 빠지면 import 자체가 실패한다.
vi.mock("../../../ipc/invoke", () => ({
  appendTaskLine: vi.fn(),
  archiveTaskLines: vi.fn(),
  getFileTasks: vi.fn().mockResolvedValue([]),
  getVaultTasks: vi.fn().mockResolvedValue([]),
  listDir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../../utils/confirm-dialog", () => ({
  showAlert: vi.fn().mockResolvedValue(undefined),
  showConfirm: vi.fn(),
}));

import { archiveTaskLines, getVaultTasks, readFile } from "../../../ipc/invoke";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { useTaskStore } from "../../../stores/tasks/task-store";
import { showAlert, showConfirm } from "../../../utils/confirm-dialog";
import { TaskAgendaPanel } from "../TaskAgendaPanel";

const ROOT = "/vault";
const INBOX = "/vault/Inbox.md";

const EMPTY: ArchiveOutcome = {
  archived: 0,
  failed: 0,
  paths: [],
  skipped: 0,
  stale: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  useTaskStore.getState().clear();
  useFileStore.setState({ rootPath: ROOT });
  useEditorStore.setState({ activeTabId: null, sourceModeTabs: [], tabs: [] });
  useSettingsStore.setState({
    locale: "en",
    tasksArchiveAfterDays: 30,
    tasksCaptureFile: "Inbox.md",
  });
});

describe("TaskAgendaPanel — 완료 항목 정리 (§312)", () => {
  it("옮길 것이 없으면 버튼 자체가 없다", () => {
    // 완료됐지만 아직 30일이 안 지난 항목. 눌러도 아무 일도 안 하는 버튼을 두면
    // 사용자는 그것이 고장인지 대상이 없는 것인지 알 수 없다.
    seed([recent()]);
    render(<TaskAgendaPanel />);

    expect(screen.queryByLabelText("Archive completed tasks")).toBeNull();
  });

  it("일반 문서의 완료 태스크는 개수에 들어가지 않는다", () => {
    // §312 불가침 규칙 — 프런트도 같은 화이트리스트로 센다. Rust가 다시 강제하지만
    // 여기서 새면 확인 문구가 옮기지도 못할 개수를 약속한다.
    seed([old_({ path: "/vault/notes/설계.md" })]);
    render(<TaskAgendaPanel />);

    expect(screen.queryByLabelText("Archive completed tasks")).toBeNull();
  });

  it("취소하면 커맨드에 아예 도달하지 않는다", async () => {
    vi.mocked(showConfirm).mockResolvedValue(false);
    seed([old_()]);
    render(<TaskAgendaPanel />);

    await userEvent.click(screen.getByLabelText("Archive completed tasks"));

    expect(showConfirm).toHaveBeenCalled();
    expect(archiveTaskLines).not.toHaveBeenCalled();
  });

  it("확인 문구가 실제 대상 개수와 설정된 경과일을 담는다", async () => {
    vi.mocked(showConfirm).mockResolvedValue(false);
    useSettingsStore.setState({ tasksArchiveAfterDays: 45 });
    seed([old_({ line: 0 }), old_({ line: 1 }), recent({ line: 2 })]);
    render(<TaskAgendaPanel />);

    await userEvent.click(screen.getByLabelText("Archive completed tasks"));

    expect(showConfirm).toHaveBeenCalledWith(
      expect.stringContaining("2"),
      expect.anything(),
    );
    expect(showConfirm).toHaveBeenCalledWith(
      expect.stringContaining("45"),
      expect.anything(),
    );
  });

  it("확인 버튼이 삭제처럼 보이지 않는다", async () => {
    // `showConfirm`의 기본 확인 문구는 "Delete"이고 위험색까지 입는다. "옮길까요?"에
    // 그 버튼을 내밀면 사용자가 취소를 누른다 — 실제로 그렇게 아무것도 옮겨지지 않았다.
    vi.mocked(showConfirm).mockResolvedValue(false);
    seed([old_()]);
    render(<TaskAgendaPanel />);

    await userEvent.click(screen.getByLabelText("Archive completed tasks"));

    expect(showConfirm).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ confirmLabel: "Archive", danger: false }),
    );
  });

  it("확인하면 대상 전부를 한 번의 호출로 넘긴다", async () => {
    vi.mocked(showConfirm).mockResolvedValue(true);
    vi.mocked(archiveTaskLines).mockResolvedValue({ ...EMPTY, archived: 2 });
    seed([old_({ line: 0 }), old_({ line: 3 })]);
    render(<TaskAgendaPanel />);

    await userEvent.click(screen.getByLabelText("Archive completed tasks"));

    await waitFor(() => expect(archiveTaskLines).toHaveBeenCalledTimes(1));
    expect(archiveTaskLines).toHaveBeenCalledWith(
      ROOT,
      INBOX,
      [
        { expectedRaw: expect.any(String), line: 0, path: INBOX },
        { expectedRaw: expect.any(String), line: 3, path: INBOX },
      ],
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      30,
    );
  });

  it("옮길 파일이 저장되지 않은 탭에 열려 있으면 시작하지 않는다", async () => {
    // 다음 저장이 그 탭의 사본으로 파일을 덮어써 옮긴 줄이 되살아난다 — 대상에는
    // 이미 붙어 있으므로 결과는 중복이다.
    seed([old_()]);
    openTab({ filePath: INBOX, id: "t1", isDirty: true });
    render(<TaskAgendaPanel />);

    await userEvent.click(screen.getByLabelText("Archive completed tasks"));

    expect(archiveTaskLines).not.toHaveBeenCalled();
    expect(showConfirm).not.toHaveBeenCalled();
    expect(showAlert).toHaveBeenCalledWith(expect.stringContaining("Inbox.md"));
  });

  it("소스 모드 탭은 clean으로 보여도 막는다", async () => {
    // ‼️ 마크다운 소스 모드 타이핑은 일부러 dirty를 세우지 않는다
    // (`tab-surface-renderers.tsx`). `isDirty`만 보면 저장 전 글을 든 탭이 그대로
    // 통과한다 — 캡처의 `assertNoUnsavedTab`이 당한 것과 같은 구멍이다.
    seed([old_()]);
    openTab({ filePath: INBOX, id: "t1", isDirty: false });
    useEditorStore.setState({ sourceModeTabs: ["t1"] });
    render(<TaskAgendaPanel />);

    await userEvent.click(screen.getByLabelText("Archive completed tasks"));

    expect(archiveTaskLines).not.toHaveBeenCalled();
  });

  it("Archive/ 아래의 저장되지 않은 탭도 막는다 — 대상 파일일 수 있다", async () => {
    // 어느 달 파일에 붙을지는 Rust가 정한다. 여기서 달을 다시 계산하면 같은 사실의
    // 진실원이 둘이 되므로 폴더 단위로 막는다.
    seed([old_()]);
    openTab({ filePath: "/vault/Archive/2026-07.md", id: "t9", isDirty: true });
    render(<TaskAgendaPanel />);

    await userEvent.click(screen.getByLabelText("Archive completed tasks"));

    expect(archiveTaskLines).not.toHaveBeenCalled();
  });

  it("관계없는 파일의 저장되지 않은 탭은 막지 않는다", async () => {
    vi.mocked(showConfirm).mockResolvedValue(true);
    vi.mocked(archiveTaskLines).mockResolvedValue({ ...EMPTY, archived: 1 });
    seed([old_()]);
    openTab({ filePath: "/vault/notes/초안.md", id: "t2", isDirty: true });
    render(<TaskAgendaPanel />);

    await userEvent.click(screen.getByLabelText("Archive completed tasks"));

    await waitFor(() => expect(archiveTaskLines).toHaveBeenCalled());
  });

  it("옮긴 파일을 열어 둔 탭을 dirty로 만들지 않는다", async () => {
    // ‼️ 여기서 dirty가 붙으면 자동 저장이 **방금 아카이브가 쓴 파일 위에** 에디터의
    // 직렬화 결과를 덮어쓴다 — `use-auto-save.ts`의 `CONTENT_SYNC_META` 분기가 막으려고
    // 존재하는 바로 그 일이고, `requestContentRefresh`를 쓰던 초판이 실제로 그랬다.
    // 디스크가 이미 진실인 경로는 §313의 공용 동기화를 타야 한다.
    vi.mocked(showConfirm).mockResolvedValue(true);
    vi.mocked(readFile).mockResolvedValue("- [ ] 남은 것\n");
    vi.mocked(archiveTaskLines).mockResolvedValue({
      ...EMPTY,
      archived: 1,
      paths: [INBOX],
    });
    seed([old_()]);
    openTab({ filePath: INBOX, id: "t1", isDirty: false });
    const refresh = vi.spyOn(
      useEditorStore.getState(),
      "requestContentRefresh",
    );
    render(<TaskAgendaPanel />);

    await userEvent.click(screen.getByLabelText("Archive completed tasks"));

    await waitFor(() =>
      expect(useFileStore.getState().openFiles.get(INBOX)).toBe(
        "- [ ] 남은 것\n",
      ),
    );
    expect(useEditorStore.getState().tabs[0]?.isDirty).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
    // 활성 탭이 아니므로 낡음 표시로 처리된다 — 돌아왔을 때 캐시가 아니라 새 내용을 읽는다.
    expect(useEditorStore.getState().staleContentTabs).toContain("t1");
  });

  it("커맨드가 거절하면 아무것도 옮기지 않았다고 말한다", async () => {
    // 화이트리스트 위반은 파일을 하나도 건드리지 않는다 — 문구가 그 사실을 담아야
    // 사용자가 절반만 옮겨졌는지 확인하러 파일을 열지 않는다.
    vi.mocked(showConfirm).mockResolvedValue(true);
    vi.mocked(archiveTaskLines).mockRejectedValue(new Error("refusing"));
    seed([old_()]);
    render(<TaskAgendaPanel />);

    await userEvent.click(screen.getByLabelText("Archive completed tasks"));

    await waitFor(() =>
      expect(showAlert).toHaveBeenCalledWith(
        expect.stringContaining("Nothing was moved"),
      ),
    );
  });

  it("경합과 사고를 한 문장으로 뭉뚱그리지 않는다", async () => {
    vi.mocked(showConfirm).mockResolvedValue(true);
    vi.mocked(archiveTaskLines).mockResolvedValue({
      ...EMPTY,
      archived: 2,
      failed: 1,
      stale: 3,
    });
    seed([old_()]);
    render(<TaskAgendaPanel />);

    await userEvent.click(screen.getByLabelText("Archive completed tasks"));

    await waitFor(() => expect(showAlert).toHaveBeenCalled());
    const message = vi.mocked(showAlert).mock.calls[0]?.[0] ?? "";
    expect(message).toContain("Archived 2");
    expect(message).toContain("3 task(s) changed elsewhere");
    expect(message).toContain("Couldn't archive 1");
  });

  it("옮긴 것이 하나도 없어도 침묵하지 않는다", async () => {
    // 전부 stale이었던 실행이 조용히 끝나면 사용자에게는 버튼이 죽은 것으로 보인다.
    vi.mocked(showConfirm).mockResolvedValue(true);
    vi.mocked(archiveTaskLines).mockResolvedValue({ ...EMPTY, stale: 1 });
    seed([old_()]);
    render(<TaskAgendaPanel />);

    await userEvent.click(screen.getByLabelText("Archive completed tasks"));

    await waitFor(() => expect(showAlert).toHaveBeenCalled());
  });
});

function isoToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 문턱을 넘긴 완료 태스크 — 기본은 수집함의 것. */
function old_(over: Partial<TaskEntry> = {}): TaskEntry {
  return task("2020-01-01", over);
}

function openTab(over: Pick<EditorTab, "filePath" | "id" | "isDirty">): void {
  useEditorStore.setState({
    tabs: [
      {
        contextId: "c1",
        isPinned: false,
        title: "tab",
        type: "file",
        ...over,
      },
    ],
  });
}

/** 완료됐지만 아직 문턱을 넘기지 않은 태스크. */
function recent(over: Partial<TaskEntry> = {}): TaskEntry {
  return task(isoToday(), over);
}

/**
 * 스토어와 스캔 양쪽에 같은 목록을 심는다.
 *
 * ‼️ `setAll`만으로는 부족하다. 패널은 마운트 직후 `refreshAllTasks`로 vault를 다시 걷고
 * 그 결과로 스토어를 통째로 갈아끼운다 — `rootPath`가 있는 이 파일에서는 그 효과가 실제로
 * 돌아, 스캔이 빈 배열을 돌려주면 클릭이 도착하기 전에 버튼이 사라진다.
 */
function seed(tasks: TaskEntry[]): void {
  vi.mocked(getVaultTasks).mockResolvedValue(tasks);
  useTaskStore.getState().setAll(tasks);
}

function task(doneDate: string, over: Partial<TaskEntry>): TaskEntry {
  return {
    cancelled: null,
    created: null,
    done: doneDate,
    due: null,
    indent: 0,
    line: 0,
    links: [],
    path: INBOX,
    priority: 0,
    raw: `- [x] 끝난 일 ✅${doneDate}`,
    recurrence: null,
    scheduled: null,
    start: null,
    state: "done",
    tags: [],
    text: "끝난 일",
    ...over,
  };
}
