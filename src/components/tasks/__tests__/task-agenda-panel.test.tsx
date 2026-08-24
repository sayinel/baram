import type { TaskEntry } from "../../../ipc/types";
import type { Editor } from "@tiptap/react";

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setTaskState = vi.fn().mockResolvedValue("- [x] 하나");
const getVaultTasks = vi.fn().mockResolvedValue([]);
const getFileTasks = vi.fn().mockResolvedValue([]);
// §305 문서 경로(활성 + dirty 탭)가 라이브 문서를 읽고 쓰는 데 쓴다.
const previewTaskStateLine = vi.fn();
const prosemirrorToMarkdown = vi.fn();

// listDir/readFile 스텁이 필요한 이유: TaskAgendaPanel → useZettelIndexStore →
// 같은 모듈에서 listDir/readFile을 import한다. 3개만 목하면 그 import가 깨진다.
vi.mock("../../../ipc/invoke", () => ({
  getFileTasks: (...a: unknown[]) => getFileTasks(...a),
  getVaultTasks: (...a: unknown[]) => getVaultTasks(...a),
  listDir: vi.fn().mockResolvedValue([]),
  previewTaskStateLine: (...a: unknown[]) => previewTaskStateLine(...a),
  readFile: vi.fn().mockResolvedValue(""),
  setTaskState: (...a: unknown[]) => setTaskState(...a),
}));

vi.mock("../../../pipeline", () => ({
  prosemirrorToMarkdown: (...a: unknown[]) => prosemirrorToMarkdown(...a),
}));

import { EditorProvider } from "../../../contexts/editor-context";
import { useEditorStore } from "../../../stores/editor/editor";
import { useSettingsStore } from "../../../stores/settings/store";
import { useTaskStore } from "../../../stores/tasks/task-store";
import { useUIStore } from "../../../stores/ui/ui";
import { TaskAgendaPanel } from "../TaskAgendaPanel";

// prosemirrorToMarkdown이 모킹돼 있으므로 실제 ProseMirror doc은 필요 없다.
const FAKE_EDITOR = { state: { doc: {} } } as unknown as Editor;

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

  it("shows a priority marker on a prioritised row and none on a normal one", () => {
    // fix #5: a role-less <span aria-label="priority 2"> is ignored by
    // several screen readers, and the number alone is not meaningful. The
    // marker now uses role="img" with a word label instead — assert that
    // real accessibility tree shape rather than the old bare aria-label.
    useTaskStore
      .getState()
      .setAll([
        task({ priority: 2, text: "urgent" }),
        task({ line: 1, priority: 0, text: "plain" }),
      ]);
    render(<TaskAgendaPanel />);

    const marker = screen.getByRole("img", { name: "Highest priority" });
    expect(marker).toHaveTextContent("🔺");
    // "plain" (priority 0) renders no marker at all, so there must be
    // exactly one img-role element on the page.
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });

  it("filters rows by state", async () => {
    useTaskStore
      .getState()
      .setAll([
        task({ text: "open one" }),
        task({ line: 1, state: "done", text: "closed one" }),
      ]);
    render(<TaskAgendaPanel />);

    await userEvent.selectOptions(
      screen.getByLabelText("Filter by state"),
      "todo",
    );

    expect(screen.getByText("open one")).toBeInTheDocument();
    expect(screen.queryByText("closed one")).not.toBeInTheDocument();
  });

  it("filters rows by tag without prefix-matching a longer tag", async () => {
    useTaskStore
      .getState()
      .setAll([
        task({ tags: ["work"], text: "work item" }),
        task({ line: 1, tags: ["workout"], text: "gym item" }),
      ]);
    render(<TaskAgendaPanel />);

    await userEvent.selectOptions(
      screen.getByLabelText("Filter by tag"),
      "work",
    );

    expect(screen.getByText("work item")).toBeInTheDocument();
    expect(screen.queryByText("gym item")).not.toBeInTheDocument();
  });

  it("hides the tag control when nothing is tagged", () => {
    useTaskStore.getState().setAll([task({ tags: [] })]);
    render(<TaskAgendaPanel />);

    expect(screen.queryByLabelText("Filter by tag")).not.toBeInTheDocument();
  });

  it("keeps every tag selectable after one is chosen", async () => {
    useTaskStore
      .getState()
      .setAll([
        task({ tags: ["work"], text: "a" }),
        task({ line: 1, tags: ["home"], text: "b" }),
      ]);
    render(<TaskAgendaPanel />);

    await userEvent.selectOptions(
      screen.getByLabelText("Filter by tag"),
      "work",
    );

    // 태그 목록을 필터 적용 후 집합에서 뽑으면 "home"이 사라져 되돌아갈 수 없다
    expect(screen.getByRole("option", { name: "#home" })).toBeInTheDocument();
  });

  it("shows every task again once the selected tag disappears entirely (I2a)", async () => {
    useTaskStore
      .getState()
      .setAll([task({ tags: ["work"], text: "work item" })]);
    render(<TaskAgendaPanel />);

    await userEvent.selectOptions(
      screen.getByLabelText("Filter by tag"),
      "work",
    );
    expect(screen.getByText("work item")).toBeInTheDocument();

    // The tag control (and the tag itself) is gone from the vault entirely —
    // e.g. the last tagged task was deleted, or tasksExcludePaths just
    // excluded the folder it lived in. `filters.tag` still holds "work"
    // internally; the derived reconciliation must stop it from zeroing out
    // the visible list.
    act(() => {
      useTaskStore
        .getState()
        .setAll([task({ tags: [], text: "untagged item" })]);
    });

    expect(screen.getByText("untagged item")).toBeInTheDocument();
    expect(screen.queryByLabelText("Filter by tag")).not.toBeInTheDocument();
  });

  it('resets the tag select to "Any tag" instead of a blank selection when the chosen tag disappears but others remain (I2b)', async () => {
    useTaskStore
      .getState()
      .setAll([
        task({ tags: ["work"], text: "work item" }),
        task({ line: 1, tags: ["home"], text: "home item" }),
      ]);
    render(<TaskAgendaPanel />);

    await userEvent.selectOptions(
      screen.getByLabelText("Filter by tag"),
      "work",
    );

    // "work" disappears (e.g. its only task was excluded) but "home" remains
    // — the select must fall back to "Any tag" rather than a selectedIndex
    // of -1 (a blank row over a populated list).
    act(() => {
      useTaskStore
        .getState()
        .setAll([task({ tags: ["home"], text: "home item" })]);
    });

    const select = screen.getByLabelText<HTMLSelectElement>("Filter by tag");
    expect(select.value).toBe("");
    expect(select.selectedOptions[0]).toHaveTextContent("Any tag");
    expect(screen.getByText("home item")).toBeInTheDocument();
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

  // §305 문서 경로 — 활성 탭이 dirty일 때만 들어간다. 이 스위트가 이 태스크가
  // 존재하는 이유(디스크를 다시 읽지 않는다)와 Minor 1(recordDoneDate가
  // 꺼져 있을 때의 done 날짜)을 검증한다.
  describe("document branch (§305 activeTab && dirty)", () => {
    beforeEach(() => {
      useEditorStore.setState({
        activeTabId: "t1",
        tabs: [
          {
            contextId: "c",
            filePath: "a.md",
            id: "t1",
            isDirty: true,
            isPinned: false,
            title: "a",
          },
        ],
      });
    });

    afterEach(() => {
      useEditorStore.setState({ activeTabId: null, tabs: [] });
      useSettingsStore.getState().setTasksRecordDoneDate(true);
    });

    it("디스크를 다시 읽지 않는다 — 이 태스크가 존재하는 이유", async () => {
      prosemirrorToMarkdown.mockReturnValue("- [ ] 하나\n");
      previewTaskStateLine.mockResolvedValue("- [x] 하나 ✅2026-08-24");
      useTaskStore.getState().setAll([task({ raw: "- [ ] 하나" })]);
      render(
        <EditorProvider value={FAKE_EDITOR}>
          <TaskAgendaPanel />
        </EditorProvider>,
      );

      await userEvent.click(screen.getByRole("checkbox", { name: /하나/ }));

      expect(setTaskState).not.toHaveBeenCalled();
      expect(getFileTasks).not.toHaveBeenCalled();
    });

    it("recordDoneDate가 꺼져 있으면 재계산 대신 실제로 쓰인 줄에서 done을 읽는다 (Minor 1)", async () => {
      useSettingsStore.getState().setTasksRecordDoneDate(false);
      // apply_state는 recordDoneDate=false일 때 기존 ✅date를 그대로 보존해
      // 돌려준다(write.rs:143-145) — 패널이 설정값으로 재계산하면 이 값과 어긋난다.
      prosemirrorToMarkdown.mockReturnValue("- [ ] 하나 ✅2026-01-01\n");
      previewTaskStateLine.mockResolvedValue("- [x] 하나 ✅2026-01-01");
      useTaskStore
        .getState()
        .setAll([task({ raw: "- [ ] 하나 ✅2026-01-01" })]);
      render(
        <EditorProvider value={FAKE_EDITOR}>
          <TaskAgendaPanel />
        </EditorProvider>,
      );

      await userEvent.click(screen.getByRole("checkbox", { name: /하나/ }));

      const patched = useTaskStore.getState().tasks[0];
      expect(patched.done).toBe("2026-01-01");
      expect(patched.raw).toBe("- [x] 하나 ✅2026-01-01");
      expect(patched.state).toBe("done");
    });

    it("완료된 태스크를 체크 해제하면 done을 null로 patch한다", async () => {
      prosemirrorToMarkdown.mockReturnValue("- [x] 하나 ✅2026-08-01\n");
      previewTaskStateLine.mockResolvedValue("- [ ] 하나");
      useTaskStore
        .getState()
        .setAll([
          task({
            done: "2026-08-01",
            raw: "- [x] 하나 ✅2026-08-01",
            state: "done",
          }),
        ]);
      render(
        <EditorProvider value={FAKE_EDITOR}>
          <TaskAgendaPanel />
        </EditorProvider>,
      );

      await userEvent.click(screen.getByRole("checkbox", { name: /하나/ }));

      const patched = useTaskStore.getState().tasks[0];
      expect(patched.done).toBeNull();
      expect(patched.state).toBe("todo");
      expect(getFileTasks).not.toHaveBeenCalled();
    });
  });
});
