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
import { t } from "../../../i18n";
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

  // ‼️ 체크 판정의 실패 문구가 정리 메뉴와 **같은 키**여야 한다. 예전에는 이 자리에
  // 하드코딩된 영어가 있었고 그 문자열은 `tasks.triage.writeFailed`의 영어와 바이트가
  // 같았다 — 한국어 사용자는 같은 실패에 메뉴에서 한국어, 체크박스에서 영어를 받았다.
  it("체크 판정의 실패 문구는 정리 조작과 같은 i18n 키를 쓴다 (MODERATE-3)", async () => {
    setTaskState.mockRejectedValueOnce("Permission denied (os error 13)");
    useTaskStore.getState().setAll([task()]);
    render(<TaskAgendaPanel />);

    await userEvent.click(screen.getByRole("checkbox", { name: /하나/ }));

    expect(useUIStore.getState().toast?.message).toBe(
      t("tasks.triage.writeFailed", "en"),
    );
    expect(useUIStore.getState().toast?.message).not.toBe(
      t("tasks.triage.writeFailed", "ko"),
    );
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
    // §308: the badge shows a short text symbol (PRIORITY_SYMBOL), not the
    // raw markdown emoji — see priorityBadge.
    expect(marker).toHaveTextContent("!!!");
    // §308 direction C — the pill is gone, and with it the class sharing
    // this test used to pin (`.task-chip` + `.task-row-priority`). The
    // editor's chip is now a dot-and-label widget with its own DOM shape
    // (see renderTaskChip), so the agenda badge no longer rides its class;
    // task-row-priority carries its own muted colour directly (tasks.css).
    expect(marker).toHaveClass("task-row-priority");
    expect(marker).not.toHaveClass("task-chip");
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

  // §312 `applyTaskFilters`\u0027 showSomeday branch is covered by unit tests, but
  // nothing rendered or clicked the checkbox that feeds it — the wiring in
  // TaskAgendaPanel was unverified (review Major 4).
  describe("Someday toggle", () => {
    const someday = task({ tags: ["someday"], text: "언젠가 Rust" });

    it("hides a #someday capture from No date by default", () => {
      useTaskStore.getState().setAll([someday]);
      render(<TaskAgendaPanel />);
      expect(screen.queryByText("언젠가 Rust")).not.toBeInTheDocument();
    });

    it("shows it once the checkbox is ticked", async () => {
      useTaskStore.getState().setAll([someday]);
      render(<TaskAgendaPanel />);

      await userEvent.click(screen.getByRole("checkbox", { name: "Someday" }));

      expect(screen.getByText("언젠가 Rust")).toBeInTheDocument();
    });

    it("hides it again when the checkbox is unticked", async () => {
      useTaskStore.getState().setAll([someday]);
      render(<TaskAgendaPanel />);
      const box = screen.getByRole("checkbox", { name: "Someday" });

      await userEvent.click(box);
      await userEvent.click(box);

      expect(screen.queryByText("언젠가 Rust")).not.toBeInTheDocument();
    });
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
      // 돌려준다(write.rs:144-146) — 설정값으로 재계산하면 이 값과 어긋난다.
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
      useTaskStore.getState().setAll([
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

// §312 소스 경로 — 활성 dirty 탭이 **소스 모드**일 때. 문서 경로와 같은 약속을
// 지켜야 한다(디스크를 다시 읽지 않는다). 다만 고치는 대상이 숨어 있는 PM 문서가
// 아니라 사용자가 보고 있는 소스 버퍼다.
describe("TaskAgendaPanel — 소스 경로 (§312)", () => {
  let buffer = "";

  beforeEach(() => {
    buffer = "- [ ] 하나\n";
    useTaskStore.getState().clear();
    useEditorStore.setState({
      activeTabId: "t1",
      sourceBufferAccess: {
        getSourceBuffer: () => buffer,
        setSourceBuffer: (_tabId, next) => {
          buffer = next;
        },
      },
      sourceModeTabs: ["t1"],
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
    useEditorStore.setState({
      activeTabId: null,
      sourceBufferAccess: null,
      sourceModeTabs: [],
      tabs: [],
    });
  });

  it("보이는 소스 버퍼를 고친다 — PM 문서가 아니다", async () => {
    // PM 문서에는 이 태스크의 줄이 아예 없다. 문서 경로로 샜다면 낙관적 잠금이
    // stale로 거절해 버퍼가 그대로 남는다 — 단정이 두 경로를 실제로 가른다.
    prosemirrorToMarkdown.mockReturnValue("- [ ] 전혀 다른 줄\n");
    previewTaskStateLine.mockResolvedValue("- [x] 하나 ✅2026-08-24");
    useTaskStore.getState().setAll([task({ raw: "- [ ] 하나" })]);
    render(
      <EditorProvider value={FAKE_EDITOR}>
        <TaskAgendaPanel />
      </EditorProvider>,
    );

    await userEvent.click(screen.getByRole("checkbox", { name: /하나/ }));

    expect(buffer).toBe("- [x] 하나 ✅2026-08-24\n");
    expect(setTaskState).not.toHaveBeenCalled();
  });

  it("디스크를 다시 읽지 않고 스토어를 직접 패치한다", async () => {
    previewTaskStateLine.mockResolvedValue("- [x] 하나 ✅2026-08-24");
    useTaskStore.getState().setAll([task({ raw: "- [ ] 하나" })]);
    render(
      <EditorProvider value={FAKE_EDITOR}>
        <TaskAgendaPanel />
      </EditorProvider>,
    );

    await userEvent.click(screen.getByRole("checkbox", { name: /하나/ }));

    expect(getFileTasks).not.toHaveBeenCalled();
    const patched = useTaskStore.getState().tasks[0];
    expect(patched.state).toBe("done");
    expect(patched.done).toBe("2026-08-24");
    expect(patched.raw).toBe("- [x] 하나 ✅2026-08-24");
  });

  it("경합으로 거절돼도 같은 버퍼의 다른 변경을 되돌리지 않는다", async () => {
    // ‼️ stale은 "아무 일도 없었다"가 아니다. 소스 경로에서 거절됐다는 것은 그 파일의
    // 진실이 아직 **저장되지 않은 버퍼**라는 뜻이고, 그 파일을 디스크에서 다시 읽으면
    // 같은 세션이 이미 버퍼에 만들어 둔 다른 줄의 변경까지 옛 내용으로 되돌아간다.
    //
    // 픽스처: 0번 줄은 조금 전에 이 패널에서 오늘로 옮겼고(버퍼에만 있다), 1번 줄은
    // 그 사이 버퍼에서 다른 텍스트가 돼 낙관적 잠금이 거절한다.
    buffer = "- [ ] 하나 📅2026-08-30\n- [ ] 둘 (버퍼에서 바뀐 뒤)\n";
    // 디스크는 아직 저장 전이라 두 줄 모두 옛 내용이다.
    getFileTasks.mockResolvedValue([
      task({ line: 0, raw: "- [ ] 하나" }),
      task({ line: 1, raw: "- [ ] 둘", text: "둘" }),
    ]);
    useTaskStore
      .getState()
      .setAll([
        task({ due: "2026-08-30", line: 0, raw: "- [ ] 하나 📅2026-08-30" }),
        task({ line: 1, raw: "- [ ] 둘", text: "둘" }),
      ]);
    render(
      <EditorProvider value={FAKE_EDITOR}>
        <TaskAgendaPanel />
      </EditorProvider>,
    );

    await userEvent.click(screen.getByRole("checkbox", { name: /둘/ }));

    // 단정은 "다시 읽지 않았다"가 아니라 **먼저 만든 변경이 살아 있다**이다.
    const first = useTaskStore.getState().tasks.find((t) => t.line === 0);
    expect(first?.due).toBe("2026-08-30");
    expect(first?.raw).toBe("- [ ] 하나 📅2026-08-30");
  });

  // 스토어를 만지지 않는 것은 옳다. 침묵까지 옳은 것은 아니다 — 이 stale은 파일을
  // 저장할 때까지 **영구적**이라, 알리지 않으면 사용자에게는 몇 번을 눌러도 아무 일도
  // 일어나지 않는 원인 모를 죽은 체크박스로만 보인다(I5).
  it("거절됐다는 것을 사용자에게 알린다", async () => {
    // 저장하지 않은 편집이 그 줄을 이미 바꿔 놨다 — 낙관적 잠금이 거절한다.
    buffer = "- [ ] 사용자가 이미 고쳐 둔 줄\n";
    useTaskStore.getState().setAll([task({ raw: "- [ ] 하나" })]);
    render(
      <EditorProvider value={FAKE_EDITOR}>
        <TaskAgendaPanel />
      </EditorProvider>,
    );

    await userEvent.click(screen.getByRole("checkbox", { name: /하나/ }));

    expect(useUIStore.getState().toast?.type).toBe("info");
    expect(getFileTasks).not.toHaveBeenCalled();
    expect(useTaskStore.getState().tasks[0].state).toBe("todo");
  });
});
