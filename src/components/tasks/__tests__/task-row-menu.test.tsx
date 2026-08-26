import type { TaskEntry } from "../../../ipc/types";
import type { TaskTriageContext } from "../../../utils/tasks/task-triage";
import type { Editor } from "@tiptap/react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setTaskField = vi.fn();
const previewTaskFieldLine = vi.fn();
const getVaultTasks = vi.fn().mockResolvedValue([]);
const getFileTasks = vi.fn().mockResolvedValue([]);
const prosemirrorToMarkdown = vi.fn();

// listDir/readFile 스텁이 필요한 이유는 task-agenda-panel.test.tsx와 같다 —
// TaskAgendaPanel → useZettelIndexStore가 같은 모듈에서 그 둘을 import한다.
vi.mock("../../../ipc/invoke", () => ({
  getFileTasks: (...a: unknown[]) => getFileTasks(...a),
  getVaultTasks: (...a: unknown[]) => getVaultTasks(...a),
  listDir: vi.fn().mockResolvedValue([]),
  previewTaskFieldLine: (...a: unknown[]) => previewTaskFieldLine(...a),
  previewTaskStateLine: vi.fn(),
  readFile: vi.fn().mockResolvedValue(""),
  setTaskField: (...a: unknown[]) => setTaskField(...a),
  setTaskState: vi.fn(),
}));

vi.mock("../../../pipeline", () => ({
  prosemirrorToMarkdown: (...a: unknown[]) => prosemirrorToMarkdown(...a),
}));

import { EditorProvider } from "../../../contexts/editor-context";
import { t } from "../../../i18n";
import { useEditorStore } from "../../../stores/editor/editor";
import { useTaskStore } from "../../../stores/tasks/task-store";
import { useUIStore } from "../../../stores/ui/ui";
import { runTaskTriageAction } from "../../../utils/tasks/task-triage";
import { TaskAgendaPanel } from "../TaskAgendaPanel";
import { TaskBucketList } from "../TaskBucketList";

// 날짜를 고정한다 — "오늘"을 테스트에서 다시 계산하면 프로덕션의 날짜 산술을
// 두 벌로 만들게 되고, 그 둘이 함께 틀리면 테스트가 아무것도 못 잡는다.
const NOW = new Date(2026, 7, 26); // 2026-08-26
const TODAY = "2026-08-26";
const TOMORROW = "2026-08-27";

const EN_T = (key: string, params?: Record<string, string>) =>
  t(key, "en", params);

const LABEL = {
  pick: EN_T("tasks.triage.duePick"),
  today: EN_T("tasks.triage.dueToday"),
  tomorrow: EN_T("tasks.triage.dueTomorrow"),
};

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

const noop = () => {};

function dialogInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    ".ai-prompt-dialog .ai-prompt-input",
  );
  if (!input) throw new Error("date dialog did not open");
  return input;
}

/** 행을 우클릭해 메뉴를 연다 — 포인터 경로의 표준 진입점. */
function openMenu(row: HTMLElement): HTMLElement {
  fireEvent.mouseDown(row, { button: 2 });
  fireEvent.contextMenu(row);
  return screen.getByRole("menu");
}

function renderRow(
  over: Partial<TaskEntry> = {},
  editor: Editor | null = null,
) {
  const entry = task(over);
  useTaskStore.getState().setAll([entry]);
  const ctx: TaskTriageContext = {
    editor,
    exclude: [],
    now: NOW,
    rootPath: null,
    t: EN_T,
  };
  render(
    <TaskBucketList
      bucket="noDate"
      label="No date"
      now={NOW}
      onJump={noop}
      onToggle={noop}
      onTriage={(target, action) => {
        void runTaskTriageAction(action, target, ctx);
      }}
      showAge={false}
      showOverdueAge={false}
      tasks={[entry]}
      titleFor={(x) => x}
    />,
  );
  return screen.getByText(entry.text).closest("li")!;
}

function submitDialog(value: string): void {
  const input = dialogInput();
  input.value = value;
  const ok = document.querySelector<HTMLButtonElement>(".ai-prompt-btn-ok");
  if (!ok) throw new Error("date dialog has no submit button");
  fireEvent.click(ok);
}

describe("§312 triage menu on an agenda row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTaskField.mockResolvedValue(`- [ ] 하나 📅${TODAY}`);
    getFileTasks.mockResolvedValue([]);
    getVaultTasks.mockResolvedValue([]);
    useTaskStore.getState().clear();
    useUIStore.getState().dismissToast();
  });

  afterEach(() => {
    // showFieldDialog는 document.body에 직접 붙는다 — RTL cleanup은 자기 컨테이너만
    // 치우므로 취소하지 않고 끝난 테스트의 오버레이가 다음 테스트로 샌다.
    document
      .querySelectorAll(".ai-prompt-overlay")
      .forEach((node) => node.remove());
  });

  describe("affordance", () => {
    it("행을 우클릭하면 정리 메뉴가 열린다", async () => {
      const row = renderRow({ text: "보고서 초안" });
      fireEvent.contextMenu(row);
      expect(await screen.findByRole("menu")).toBeInTheDocument();
    });

    it("메뉴를 열지 않은 행에는 메뉴가 없다", () => {
      renderRow();
      expect(screen.queryByRole("menu")).toBeNull();
    });

    // §315는 마우스 없이 네 조작에 닿아야 한다 — 우클릭만 있으면 다시 만들어야 한다.
    it("포커스된 행에서 d를 누르면 같은 메뉴가 열린다", async () => {
      const row = renderRow();
      row.focus();
      fireEvent.keyDown(row, { key: "d" });
      expect(await screen.findByRole("menu")).toBeInTheDocument();
    });

    it("Escape는 메뉴를 닫고 포커스를 행으로 돌려준다", () => {
      const row = renderRow();
      const menu = openMenu(row);

      fireEvent.keyDown(menu, { key: "Escape" });

      expect(screen.queryByRole("menu")).toBeNull();
      expect(document.activeElement).toBe(row);
    });

    it("바깥을 누르면 닫힌다", () => {
      const row = renderRow();
      openMenu(row);

      fireEvent.mouseDown(document.body);

      expect(screen.queryByRole("menu")).toBeNull();
    });

    it("메뉴 안을 누르는 것으로는 닫히지 않는다", () => {
      const row = renderRow();
      const menu = openMenu(row);

      fireEvent.mouseDown(menu);

      expect(screen.getByRole("menu")).toBeInTheDocument();
    });

    it("j/k로 행 사이를 옮긴다", () => {
      const first = task({ text: "첫째" });
      const second = task({ line: 1, text: "둘째" });
      render(
        <TaskBucketList
          bucket="noDate"
          label="No date"
          now={NOW}
          onJump={noop}
          onToggle={noop}
          onTriage={noop}
          showAge={false}
          showOverdueAge={false}
          tasks={[first, second]}
          titleFor={(x) => x}
        />,
      );
      const rowA = screen.getByText("첫째").closest("li")!;
      const rowB = screen.getByText("둘째").closest("li")!;

      rowA.focus();
      fireEvent.keyDown(rowA, { key: "j" });
      expect(document.activeElement).toBe(rowB);

      fireEvent.keyDown(rowB, { key: "k" });
      expect(document.activeElement).toBe(rowA);
    });
  });

  describe("date assignment", () => {
    it("‘오늘로’는 그 행의 expected_raw로 due를 오늘로 세운다", async () => {
      const row = renderRow();
      const menu = openMenu(row);

      fireEvent.click(screen.getByRole("menuitem", { name: LABEL.today }));

      // ‼️ setTaskField는 위치 인자다(src/ipc/task.ts) — 객체가 아니다.
      await waitFor(() =>
        expect(setTaskField).toHaveBeenCalledWith(
          "a.md",
          0,
          "- [ ] 하나",
          "due",
          TODAY,
        ),
      );
      expect(menu).not.toBeInTheDocument();
    });

    it("‘내일로’는 다음 날로 세운다 — 두 항목이 같은 날짜를 쓰지 않는다", async () => {
      const row = renderRow();
      openMenu(row);

      fireEvent.click(screen.getByRole("menuitem", { name: LABEL.tomorrow }));

      await waitFor(() =>
        expect(setTaskField).toHaveBeenCalledWith(
          "a.md",
          0,
          "- [ ] 하나",
          "due",
          TOMORROW,
        ),
      );
    });

    it("디스크에 썼으면 그 파일만 다시 읽는다", async () => {
      const row = renderRow();
      openMenu(row);

      fireEvent.click(screen.getByRole("menuitem", { name: LABEL.today }));

      await waitFor(() =>
        expect(getFileTasks).toHaveBeenCalledWith("a.md", null, []),
      );
    });

    it("stale은 조용히 재스캔만 한다 — 오류 토스트를 띄우지 않는다", async () => {
      setTaskField.mockRejectedValueOnce("stale");
      const row = renderRow();
      openMenu(row);

      fireEvent.click(screen.getByRole("menuitem", { name: LABEL.today }));

      await waitFor(() =>
        expect(getFileTasks).toHaveBeenCalledWith("a.md", null, []),
      );
      expect(useUIStore.getState().toast).toBeNull();
    });

    it("stale이 아닌 실패는 토스트로 알린다", async () => {
      setTaskField.mockRejectedValueOnce("Permission denied (os error 13)");
      const row = renderRow();
      openMenu(row);

      fireEvent.click(screen.getByRole("menuitem", { name: LABEL.today }));

      await waitFor(() =>
        expect(useUIStore.getState().toast?.type).toBe("error"),
      );
    });

    // dev/backlog.md P2: 파서는 날짜 이모지의 **첫** 등장을 읽고 writer는 **마지막
    // 유효한** 것을 쓴다. 본문에 장식용 📅가 있으면 task.due가 거짓 음성이므로
    // 그것으로 항목을 잠그면 멀쩡한 행에서 메뉴가 죽는다.
    it("이미 due가 있는 행에서도 날짜 항목은 활성이다", async () => {
      const row = renderRow({
        due: "2026-01-01",
        raw: "- [ ] 하나 📅2026-01-01",
      });
      openMenu(row);

      const item = screen.getByRole("menuitem", { name: LABEL.today });
      expect(item).not.toHaveAttribute("aria-disabled", "true");

      fireEvent.click(item);

      await waitFor(() =>
        expect(setTaskField).toHaveBeenCalledWith(
          "a.md",
          0,
          "- [ ] 하나 📅2026-01-01",
          "due",
          TODAY,
        ),
      );
    });
  });

  describe("keyboard activation", () => {
    it("방향키가 강조를 옮기고 Enter가 강조된 항목을 실행한다", async () => {
      const row = renderRow();
      const menu = openMenu(row);

      fireEvent.keyDown(menu, { key: "ArrowDown" });

      expect(menu).toHaveAttribute(
        "aria-activedescendant",
        screen.getByRole("menuitem", { name: LABEL.tomorrow }).id,
      );

      fireEvent.keyDown(menu, { key: "Enter" });

      await waitFor(() =>
        expect(setTaskField).toHaveBeenCalledWith(
          "a.md",
          0,
          "- [ ] 하나",
          "due",
          TOMORROW,
        ),
      );
    });
  });

  describe("pick a date", () => {
    it("입력한 상대 날짜를 ISO로 풀어 쓴다", async () => {
      const row = renderRow();
      openMenu(row);

      fireEvent.click(screen.getByRole("menuitem", { name: LABEL.pick }));
      await waitFor(() => dialogInput());
      submitDialog("+2");

      await waitFor(() =>
        expect(setTaskField).toHaveBeenCalledWith(
          "a.md",
          0,
          "- [ ] 하나",
          "due",
          "2026-08-28",
        ),
      );
    });

    it("읽을 수 없는 입력은 쓰지 않고 알린다", async () => {
      const row = renderRow();
      openMenu(row);

      fireEvent.click(screen.getByRole("menuitem", { name: LABEL.pick }));
      await waitFor(() => dialogInput());
      submitDialog("next tuesday");

      await waitFor(() =>
        expect(useUIStore.getState().toast?.type).toBe("error"),
      );
      expect(setTaskField).not.toHaveBeenCalled();
    });

    it("취소하면 아무것도 쓰지 않는다", async () => {
      const row = renderRow();
      openMenu(row);

      fireEvent.click(screen.getByRole("menuitem", { name: LABEL.pick }));
      await waitFor(() => dialogInput());
      fireEvent.click(
        document.querySelector<HTMLButtonElement>(".ai-prompt-btn-cancel")!,
      );

      await waitFor(() =>
        expect(document.querySelector(".ai-prompt-overlay")).toBeNull(),
      );
      expect(setTaskField).not.toHaveBeenCalled();
      expect(useUIStore.getState().toast).toBeNull();
    });

    it("빈 채로 확인한 것은 취소와 같다 — 오류를 띄우지 않는다", async () => {
      const row = renderRow();
      openMenu(row);

      fireEvent.click(screen.getByRole("menuitem", { name: LABEL.pick }));
      await waitFor(() => dialogInput());
      submitDialog("   ");

      await waitFor(() =>
        expect(document.querySelector(".ai-prompt-overlay")).toBeNull(),
      );
      expect(setTaskField).not.toHaveBeenCalled();
      expect(useUIStore.getState().toast).toBeNull();
    });
  });

  // §312 소스 경로 — 화면에 보이는 것이 CodeMirror 버퍼일 때. 디스크에 쓰면 사용자가
  // 보고 있는 텍스트에는 아무 일도 일어나지 않고, 저장 시 버퍼가 그것을 덮어쓴다.
  describe("source-mode buffer", () => {
    let buffer = "";

    beforeEach(() => {
      buffer = "- [ ] 하나\n";
      previewTaskFieldLine.mockResolvedValue(`- [ ] 하나 📅${TODAY}`);
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

    it("보이는 버퍼에 날짜를 쓰고 디스크는 건드리지 않는다", async () => {
      const row = renderRow({}, FAKE_EDITOR);
      openMenu(row);

      fireEvent.click(screen.getByRole("menuitem", { name: LABEL.today }));

      await waitFor(() => expect(buffer).toBe(`- [ ] 하나 📅${TODAY}\n`));
      expect(setTaskField).not.toHaveBeenCalled();
      expect(getFileTasks).not.toHaveBeenCalled();
    });

    it("저장 전이므로 디스크를 다시 읽지 않고 스토어를 직접 패치한다", async () => {
      const row = renderRow({}, FAKE_EDITOR);
      openMenu(row);

      fireEvent.click(screen.getByRole("menuitem", { name: LABEL.today }));

      await waitFor(() =>
        expect(useTaskStore.getState().tasks[0].due).toBe(TODAY),
      );
      expect(useTaskStore.getState().tasks[0].raw).toBe(
        `- [ ] 하나 📅${TODAY}`,
      );
      expect(getFileTasks).not.toHaveBeenCalled();
    });

    // ‼️ 소스 경로의 stale은 디스크와 무관하다. 다시 읽으면 같은 세션이 그 버퍼에
    // 이미 만들어 둔 **다른 줄의** 변경까지 옛 디스크 내용으로 되돌아간다 —
    // `isDiskAuthoritative`가 `isUnsavedWrite`와 따로 있어야 하는 이유가 이 경우다.
    it("버퍼가 그 사이 바뀌어 거절되면 디스크를 다시 읽지 않는다", async () => {
      // preview IPC를 기다리는 사이 사용자가 CodeMirror에서 그 줄을 고쳤다 —
      // 낙관적 잠금이 거절하는 실제 경합의 모양이다(applyToContent의 `refresh`).
      let reads = 0;
      useEditorStore.setState({
        sourceBufferAccess: {
          getSourceBuffer: () =>
            reads++ === 0 ? buffer : "- [ ] 사용자가 방금 고친 줄\n",
          setSourceBuffer: (_tabId, next) => {
            buffer = next;
          },
        },
      });
      const row = renderRow({}, FAKE_EDITOR);
      openMenu(row);

      fireEvent.click(screen.getByRole("menuitem", { name: LABEL.today }));

      await waitFor(() => expect(previewTaskFieldLine).toHaveBeenCalled());
      expect(getFileTasks).not.toHaveBeenCalled();
      expect(buffer).toBe("- [ ] 하나\n");
    });
  });

  // 위의 단정들은 전부 고정된 `now`로 배선한 디스패처를 탄다. 패널이 그 배선을
  // 실제로 하고 있는지는 별개의 사실이라 한 번은 진짜 패널에서 확인한다.
  it("아젠다 패널의 행에서도 같은 경로가 돈다", async () => {
    useTaskStore.getState().setAll([task({ due: "2000-01-01" })]);
    render(
      <EditorProvider value={null}>
        <TaskAgendaPanel />
      </EditorProvider>,
    );

    fireEvent.contextMenu(screen.getByText("하나"));
    fireEvent.click(screen.getByRole("menuitem", { name: LABEL.today }));

    await waitFor(() =>
      expect(setTaskField).toHaveBeenCalledWith(
        "a.md",
        0,
        "- [ ] 하나",
        "due",
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      ),
    );
  });
});
