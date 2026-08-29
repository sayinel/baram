import type { TaskEntry } from "../../../ipc/types";
import type { TaskTriageContext } from "../../../utils/tasks/task-triage";
import type { Editor } from "@tiptap/react";

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const deleteTaskLine = vi.fn();
const setTaskField = vi.fn();
const setTaskTag = vi.fn();
const previewTaskFieldLine = vi.fn();
const previewTaskTagLine = vi.fn();
const getVaultTasks = vi.fn().mockResolvedValue([]);
const getFileTasks = vi.fn().mockResolvedValue([]);
const prosemirrorToMarkdown = vi.fn();

// listDir/readFile 스텁이 필요한 이유는 task-agenda-panel.test.tsx와 같다 —
// TaskAgendaPanel → useZettelIndexStore가 같은 모듈에서 그 둘을 import한다.
vi.mock("../../../ipc/invoke", () => ({
  deleteTaskLine: (...a: unknown[]) => deleteTaskLine(...a),
  getFileTasks: (...a: unknown[]) => getFileTasks(...a),
  getVaultTasks: (...a: unknown[]) => getVaultTasks(...a),
  listDir: vi.fn().mockResolvedValue([]),
  previewTaskFieldLine: (...a: unknown[]) => previewTaskFieldLine(...a),
  previewTaskStateLine: vi.fn(),
  previewTaskTagLine: (...a: unknown[]) => previewTaskTagLine(...a),
  readFile: vi.fn().mockResolvedValue(""),
  setTaskField: (...a: unknown[]) => setTaskField(...a),
  setTaskState: vi.fn(),
  setTaskTag: (...a: unknown[]) => setTaskTag(...a),
}));

vi.mock("../../../pipeline", () => ({
  prosemirrorToMarkdown: (...a: unknown[]) => prosemirrorToMarkdown(...a),
}));

import { EditorProvider } from "../../../contexts/editor-context";
import { t } from "../../../i18n";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
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
  someday: EN_T("tasks.triage.someday"),
  somedayOff: EN_T("tasks.triage.somedayOff"),
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

/**
 * 실제로 포커스를 옮긴다 — jsdom이 focusout을 내보내고 React의 onBlur가 그것을 본다.
 * `fireEvent.blur`는 relatedTarget을 손으로 지어내야 하므로 "포커스가 어디로 갔는가"를
 * 검증할 수 없다.
 */
function moveFocusTo(el: HTMLElement): void {
  act(() => {
    el.focus();
  });
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

/**
 * 버킷을 **둘** 렌더한다.
 *
 * ‼️ 버킷 하나짜리 테스트는 "메뉴가 버킷을 넘어 둘 다 열린다"는 결함을 어떻게 써도
 * 잡지 못한다 — `menu` state가 `TaskBucketList` 인스턴스마다 따로 있기 때문이다.
 */
function renderTwoBuckets(): { rowA: HTMLElement; rowB: HTMLElement } {
  const a = task({ text: "A행" });
  const b = task({ path: "b.md", text: "B행" });
  useTaskStore.getState().setAll([a, b]);
  const ctx: TaskTriageContext = {
    editor: null,
    exclude: [],
    now: NOW,
    t: EN_T,
  };
  const bucket = (label: string, tasks: TaskEntry[]) => (
    <TaskBucketList
      bucket="noDate"
      label={label}
      now={NOW}
      onJump={noop}
      onToggle={noop}
      onTriage={(target, action) => {
        void runTaskTriageAction(action, target, ctx);
      }}
      showAge={false}
      showOverdueAge={false}
      tasks={tasks}
      titleFor={(x) => x}
    />
  );
  render(
    <>
      {bucket("A", [a])}
      {bucket("B", [b])}
    </>,
  );
  return {
    rowA: screen.getByText("A행").closest("li")!,
    rowB: screen.getByText("B행").closest("li")!,
  };
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
    setTaskTag.mockResolvedValue("- [ ] 하나 #someday");
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

    // 파괴적 항목이라는 사실은 `buildTriageItems`의 `danger` 한 필드에서 나와 클래스로
    // 도착해야 한다(tasks.css가 거기에 경고색과 구분선을 건다). 데이터에만 있고 DOM에
    // 닿지 않으면 되돌릴 수 없는 항목이 나머지와 똑같아 보인다.
    it("삭제 항목만 파괴적 항목으로 그려진다", () => {
      const row = renderRow();
      const items = [...openMenu(row).querySelectorAll(".task-row-menu-item")];

      const danger = items.filter((el) =>
        el.classList.contains("task-row-menu-item-danger"),
      );
      expect(danger).toHaveLength(1);
      // 라벨 뒤에 키 힌트(aria-hidden)가 붙으므로 부분 일치로 본다.
      expect(danger[0].textContent).toContain(EN_T("tasks.triage.delete"));
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

    // 메뉴 **자체**는 role="menu" + aria-activedescendant까지 갖췄지만, 진입점이
    // 아무 말도 하지 않으면 스크린리더 사용자는 메뉴가 있다는 사실에 도달할 방법이 없다.
    it("행이 메뉴의 존재와 자기 메뉴의 열림 여부를 알린다", () => {
      // 행이 둘이어야 `aria-expanded`가 **그 행의** 상태인지 버킷 전체의 상태인지
      // 갈린다 — 하나뿐이면 둘이 같은 값이라 아무것도 증명하지 못한다.
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

      expect(rowA).toHaveAttribute("aria-haspopup", "menu");
      expect(rowA).toHaveAttribute("aria-expanded", "false");

      openMenu(rowA);

      expect(rowA).toHaveAttribute("aria-expanded", "true");
      expect(rowB).toHaveAttribute("aria-expanded", "false");
    });
  });

  // §315는 키보드 우선 표면이다. 아래 셋은 전부 **포인터를 한 번도 쓰지 않는**
  // 경로에서만 드러나는 결함이다 — 바깥 mousedown 리스너가 덮지 못하는 절반.
  describe("menu lifecycle", () => {
    it("버킷을 넘어 키보드로 열어도 화면의 메뉴는 하나뿐이다", () => {
      const { rowA, rowB } = renderTwoBuckets();

      rowA.focus();
      fireEvent.keyDown(rowA, { key: "d" });
      expect(screen.getAllByRole("menu")).toHaveLength(1);

      // Tab이든 클릭이든 — 포커스가 메뉴를 떠나는 모든 경로의 최소 재현이다.
      moveFocusTo(rowB);
      fireEvent.keyDown(rowB, { key: "d" });

      expect(screen.getAllByRole("menu")).toHaveLength(1);
    });

    it("포커스가 메뉴를 떠나면 닫히고, 포커스를 도로 뺏지 않는다", () => {
      const { rowA, rowB } = renderTwoBuckets();
      rowA.focus();
      fireEvent.keyDown(rowA, { key: "d" });

      moveFocusTo(rowB);

      expect(screen.queryByRole("menu")).toBeNull();
      // ‼️ 여기서 opener(rowA)로 포커스를 돌려주면 Tab이 제자리를 맴돈다 —
      // 사용자가 방금 옮겨 간 곳에서 포커스를 빼앗는 셈이다.
      expect(document.activeElement).toBe(rowB);
    });

    // 포커스가 **아무 데로도** 가지 않을 때(relatedTarget이 null) 무엇을 하는가가
    // "닫을 때 포커스를 옮기는가"를 가르는 유일한 관측점이다 — 행으로 옮겨 가는
    // 경우에는 jsdom이 진행 중인 포커스 전환 안의 focus()를 삼켜 차이가 보이지 않는다.
    it("포커스를 잃은 메뉴는 포커스를 되찾아 오지 않는다", () => {
      const { rowA } = renderTwoBuckets();
      rowA.focus();
      fireEvent.keyDown(rowA, { key: "d" });
      const menu = screen.getByRole("menu");

      act(() => {
        menu.blur();
      });

      expect(screen.queryByRole("menu")).toBeNull();
      // ‼️ 여기서 opener로 focus()를 걸면 Tab으로 빠져나가려는 사용자를 매번 행으로
      // 끌어당긴다. 포커스를 되돌리는 것은 Escape의 몫이지 blur의 몫이 아니다.
      expect(document.activeElement).toBe(document.body);
    });

    // 워처·다른 버킷의 토글·필터 입력이 전부 tasks를 갈아끼운다. 메뉴가 그보다
    // 오래 살면 화면에 없는 행의 옛 좌표에 떠 있고, 그 항목을 실행하면 보이지 않는
    // 태스크에 쓰기가 나간다.
    it("행이 목록에서 사라지면 메뉴도 사라진다", () => {
      const first = task({ text: "첫째" });
      const second = task({ line: 1, text: "둘째" });
      const view = (tasks: TaskEntry[]) => (
        <TaskBucketList
          bucket="noDate"
          label="No date"
          now={NOW}
          onJump={noop}
          onToggle={noop}
          onTriage={noop}
          showAge={false}
          showOverdueAge={false}
          tasks={tasks}
          titleFor={(x) => x}
        />
      );
      const { rerender } = render(view([first, second]));
      openMenu(screen.getByText("첫째").closest("li")!);
      expect(screen.getByRole("menu")).toBeInTheDocument();

      rerender(view([second]));

      expect(screen.queryByRole("menu")).toBeNull();
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

  // §312 `#someday`. 쓰기 회계 자체는 utils/tasks/__tests__/task-triage-tag.test.ts가
  // 본다 — 여기서 보는 것은 그 항목이 **이 메뉴에** 있고, 라벨이 그 행의 태그 상태를
  // 따르며, 눌렀을 때 그 행의 expected_raw로 쓰기가 나가는가다.
  describe("#someday", () => {
    it("태그가 없는 행은 미루기 항목을 보이고, 누르면 태그를 켠다", async () => {
      const row = renderRow();
      const menu = openMenu(row);

      fireEvent.click(screen.getByRole("menuitem", { name: LABEL.someday }));

      // ‼️ setTaskTag는 위치 인자다(src/ipc/task.ts) — 객체가 아니다.
      await waitFor(() =>
        expect(setTaskTag).toHaveBeenCalledWith(
          "a.md",
          0,
          "- [ ] 하나",
          "someday",
          true,
        ),
      );
      expect(menu).not.toBeInTheDocument();
    });

    // MODERATE-1: 파서가 `#someday-maybe`를 `someday`로 읽지만 쓰는 쪽은 그 줄에서
    // `#someday`를 찾지 못한다 — 해제는 줄을 한 바이트도 바꾸지 못한다.
    it("해제할 수 없는 행에서는 눌러도 쓰기가 나가지 않는다", async () => {
      const row = renderRow({
        raw: "- [ ] 여행 #someday-maybe",
        tags: ["someday"],
        text: "여행 #someday-maybe",
      });
      openMenu(row);

      const item = screen.getByRole("menuitem", {
        name: EN_T("tasks.triage.somedayLocked"),
      });
      expect(item).toHaveAttribute("aria-disabled", "true");

      fireEvent.click(item);

      await waitFor(() => expect(setTaskTag).not.toHaveBeenCalled());
      // 항목이 사라지지 않으므로 메뉴도 그대로다 — 라벨을 다시 읽을 수 있어야 한다.
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });

    // 키보드 경로는 클릭과 따로 판정한다 — 한쪽만 막으면 다른 쪽으로 샌다.
    it("해제할 수 없는 항목 위에서 Enter를 눌러도 쓰기가 나가지 않는다", async () => {
      const row = renderRow({
        raw: "- [ ] 여행 #someday-maybe",
        tags: ["someday"],
        text: "여행 #someday-maybe",
      });
      const menu = openMenu(row);

      // 항목 순서: 오늘·내일·직접 선택·someday·삭제. 강조는 0에서 시작한다.
      for (let i = 0; i < 3; i++) fireEvent.keyDown(menu, { key: "ArrowDown" });
      expect(menu.getAttribute("aria-activedescendant")).toBe(
        screen.getByRole("menuitem", {
          name: EN_T("tasks.triage.somedayLocked"),
        }).id,
      );

      fireEvent.keyDown(menu, { key: "Enter" });

      await waitFor(() => expect(setTaskTag).not.toHaveBeenCalled());
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });

    it("이미 someday인 행은 해제 항목을 보이고, 누르면 태그를 끈다", async () => {
      setTaskTag.mockResolvedValue("- [ ] 하나");
      const row = renderRow({
        raw: "- [ ] 하나 #someday",
        tags: ["someday"],
        text: "하나 #someday",
      });
      openMenu(row);

      expect(
        screen.queryByRole("menuitem", { name: LABEL.someday }),
      ).toBeNull();
      fireEvent.click(screen.getByRole("menuitem", { name: LABEL.somedayOff }));

      await waitFor(() =>
        expect(setTaskTag).toHaveBeenCalledWith(
          "a.md",
          0,
          "- [ ] 하나 #someday",
          "someday",
          false,
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

    // 이 stale은 저장 전까지 **영구적**이다 — 태스크 스토어가 그 파일에 대해 계속
    // 낡아 있으므로 사용자가 몇 번을 눌러도 영원히 아무 일도 일어나지 않는다.
    // 스토어를 만지지 않는 것은 옳지만(다시 읽으면 같은 버퍼의 다른 줄 변경이
    // 되돌아간다) 침묵까지 옳은 것은 아니다 — I5의 "원인 모를 죽은 체크박스"다.
    it("거절됐다는 것을 사용자에게 알린다", async () => {
      // 저장하지 않은 편집이 그 줄을 이미 바꿔 놨다 — 낙관적 잠금이 거절한다.
      buffer = "- [ ] 사용자가 이미 고쳐 둔 줄\n";
      const row = renderRow({}, FAKE_EDITOR);
      openMenu(row);

      fireEvent.click(screen.getByRole("menuitem", { name: LABEL.today }));

      await waitFor(() =>
        expect(useUIStore.getState().toast?.type).toBe("info"),
      );
      // 알리기만 한다 — 재스캔도 스토어 갱신도 없다.
      expect(getFileTasks).not.toHaveBeenCalled();
      expect(useTaskStore.getState().tasks[0].due).toBeNull();
    });
  });

  // §305 문서 경로 — 화면에 보이는 것이 라이브 ProseMirror 문서일 때. 소스 경로와
  // 대칭인 분기인데 이 커밋의 테스트에는 없었다. 이 슬라이스에서 데이터 손실 결함은
  // 정확히 테스트가 없던 분기에 있었다.
  describe("open document", () => {
    let doc = "";

    beforeEach(() => {
      doc = "- [ ] 하나\n";
      previewTaskFieldLine.mockResolvedValue(`- [ ] 하나 📅${TODAY}`);
      prosemirrorToMarkdown.mockImplementation(() => doc);
      useEditorStore.setState({
        activeTabId: "t1",
        // 소스 모드가 아니다 — 소스 판정이 document 판정 앞에 있으므로 이 목록이
        // 비어 있어야 문서 경로에 닿는다.
        sourceModeTabs: [],
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
        sourceModeTabs: [],
        tabs: [],
      });
      useFileStore.setState({ openFiles: new Map() });
    });

    it("보이는 문서에 날짜를 쓰고 디스크는 건드리지 않는다", async () => {
      const row = renderRow({}, FAKE_EDITOR);
      openMenu(row);

      fireEvent.click(screen.getByRole("menuitem", { name: LABEL.today }));

      await waitFor(() =>
        expect(useFileStore.getState().openFiles.get("a.md")).toBe(
          `- [ ] 하나 📅${TODAY}\n`,
        ),
      );
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

    // 소스 경로와 같은 이유로 디스크를 다시 읽으면 안 된다 — 문서의 진실은 아직
    // 저장되지 않은 버퍼이고, 다시 읽으면 그 문서의 다른 변경까지 되돌아간다.
    it("문서가 그 사이 바뀌어 거절되면 디스크를 다시 읽지 않고 알린다", async () => {
      doc = "- [ ] 사용자가 방금 고친 줄\n";
      const row = renderRow({}, FAKE_EDITOR);
      openMenu(row);

      fireEvent.click(screen.getByRole("menuitem", { name: LABEL.today }));

      await waitFor(() =>
        expect(useUIStore.getState().toast?.type).toBe("info"),
      );
      expect(getFileTasks).not.toHaveBeenCalled();
      expect(useTaskStore.getState().tasks[0].due).toBeNull();
      expect(useFileStore.getState().openFiles.get("a.md")).toBeUndefined();
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
