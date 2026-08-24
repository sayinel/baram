// §309 × §305 일괄 재조정이 **실제 라우터**에 대고 도는 유일한 스위트.
// 두 태스크의 이음매(라우팅 + 배치)가 정확히 여기 산다 — applyTaskWrite를
// 모킹해 버리면 아래 두 회귀가 전부 보이지 않게 된다.
import type { TaskEntry } from "../../../ipc/types";
import type { EditorTab } from "../../../stores/editor/editor";
import type { Editor } from "@tiptap/react";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/invoke", () => ({
  getFileTasks: vi.fn().mockResolvedValue([]),
  getVaultTasks: vi.fn().mockResolvedValue([]),
  previewTaskFieldLine: vi.fn(),
  previewTaskStateLine: vi.fn(),
  setTaskField: vi.fn(),
  setTaskState: vi.fn(),
}));

vi.mock("../../../pipeline", () => ({
  prosemirrorToMarkdown: vi.fn(),
}));

import { previewTaskFieldLine, setTaskField } from "../../../ipc/invoke";
import { prosemirrorToMarkdown } from "../../../pipeline";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { useTaskStore } from "../../../stores/tasks/task-store";
import { rescheduleOverdueToToday } from "../task-bulk-actions";

const PATH = "/v/note.md";

// prosemirrorToMarkdown이 모킹돼 있으므로 실제 ProseMirror doc은 필요 없다.
const FAKE_EDITOR = { state: { doc: {} } } as unknown as Editor;

const OPEN_TAB: EditorTab = {
  contextId: "c",
  filePath: PATH,
  id: "t1",
  isDirty: true,
  isPinned: false,
  title: "note",
};

function task(over: Partial<TaskEntry> = {}): TaskEntry {
  return {
    cancelled: null,
    created: null,
    done: null,
    due: "2026-08-20",
    indent: 0,
    line: 0,
    links: [],
    path: PATH,
    priority: 0,
    raw: "- [ ] a 📅2026-08-20",
    recurrence: null,
    scheduled: null,
    start: null,
    state: "todo",
    tags: [],
    text: "a",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({ activeTabId: "t1", tabs: [OPEN_TAB] });
  useFileStore.setState({ openFiles: new Map() });
  useTaskStore.getState().clear();
  // Rust 대역 — 날짜 필드만 갈아끼운다(정규 포맷은 필드를 줄 끝에 모은다).
  vi.mocked(previewTaskFieldLine).mockImplementation((raw, field, value) =>
    Promise.resolve(
      raw.replace(
        field === "due" ? /📅\d{4}-\d{2}-\d{2}/ : /⏳\d{4}-\d{2}-\d{2}/,
        `${field === "due" ? "📅" : "⏳"}${value}`,
      ),
    ),
  );
});

describe("rescheduleOverdueToToday — 열린 문서 배치 (§305 라우터 실물)", () => {
  it("같은 문서의 태스크 여럿이 서로를 덮어쓰지 않는다 — 문서를 한 번만 커밋한다", async () => {
    // 에디터의 doc은 반복 사이에 **갱신되지 않는다**(React가 커밋해야 따라온다).
    // 반복마다 라이브 문서를 다시 읽어 통째로 덮으면 앞의 변경이 사라진다.
    vi.mocked(prosemirrorToMarkdown).mockReturnValue(
      "- [ ] a 📅2026-08-20\n- [ ] b 📅2026-08-21\n",
    );
    const before = useEditorStore.getState().contentRefreshKey;

    const r = await rescheduleOverdueToToday(
      [
        task({ line: 0, raw: "- [ ] a 📅2026-08-20" }),
        task({ due: "2026-08-21", line: 1, raw: "- [ ] b 📅2026-08-21" }),
      ],
      "2026-08-24",
      FAKE_EDITOR,
    );

    expect(useFileStore.getState().openFiles.get(PATH)).toBe(
      "- [ ] a 📅2026-08-24\n- [ ] b 📅2026-08-24\n",
    );
    // 커밋은 정확히 한 번 — 태스크마다 에디터를 재생성하면 되돌리기 히스토리가
    // 태스크 수만큼 날아간다.
    expect(useEditorStore.getState().contentRefreshKey).toBe(before + 1);
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
    expect(r).toMatchObject({ failed: 0, stale: 0, updated: 2 });
  });

  it("문서에 쓴 파일은 diskPaths에 넣지 않고 스토어를 직접 패치한다 — 다시 읽으면 되돌아간다", async () => {
    vi.mocked(prosemirrorToMarkdown).mockReturnValue("- [ ] a 📅2026-08-20\n");
    const entry = task();
    useTaskStore.getState().setAll([entry]);

    const r = await rescheduleOverdueToToday(
      [entry],
      "2026-08-24",
      FAKE_EDITOR,
    );

    // 저장 전이므로 디스크에는 옛 줄이 있다 — 호출자가 이 경로를 다시 읽으면
    // 방금 만든 변경이 아젠다에서 통째로 되돌아간다.
    expect(r.diskPaths).toEqual([]);
    expect(setTaskField).not.toHaveBeenCalled();
    expect(useTaskStore.getState().tasks[0]).toMatchObject({
      due: "2026-08-24",
      raw: "- [ ] a 📅2026-08-24",
    });
  });

  it("`⏳`만 있는 태스크는 문서 경로에서도 scheduled를 밀고 스토어에도 그 필드만 반영한다", async () => {
    vi.mocked(prosemirrorToMarkdown).mockReturnValue("- [ ] a ⏳2026-08-01\n");
    const entry = task({
      due: null,
      raw: "- [ ] a ⏳2026-08-01",
      scheduled: "2026-08-01",
    });
    useTaskStore.getState().setAll([entry]);

    await rescheduleOverdueToToday([entry], "2026-08-24", FAKE_EDITOR);

    expect(useFileStore.getState().openFiles.get(PATH)).toBe(
      "- [ ] a ⏳2026-08-24\n",
    );
    // `due`를 채우면 스토어가 파일에 없는 마감을 주장하게 된다.
    expect(useTaskStore.getState().tasks[0]).toMatchObject({
      due: null,
      scheduled: "2026-08-24",
    });
  });

  it("열린 파일과 닫힌 파일이 섞이면 닫힌 쪽만 디스크로 가고 diskPaths에 남는다", async () => {
    vi.mocked(prosemirrorToMarkdown).mockReturnValue("- [ ] a 📅2026-08-20\n");
    vi.mocked(setTaskField).mockResolvedValue("- [ ] c 📅2026-08-24");

    const r = await rescheduleOverdueToToday(
      [task(), task({ path: "/v/other.md", raw: "- [ ] c 📅2026-08-20" })],
      "2026-08-24",
      FAKE_EDITOR,
    );

    expect(setTaskField).toHaveBeenCalledTimes(1);
    expect(setTaskField).toHaveBeenCalledWith(
      "/v/other.md",
      0,
      "- [ ] c 📅2026-08-20",
      "due",
      "2026-08-24",
    );
    expect(r.diskPaths).toEqual(["/v/other.md"]);
    expect(r.updated).toBe(2);
    // 합 불변식을 디스크 전용이 아니라 **디스크+문서 혼합** 배치에서 본다 —
    // 어느 한쪽 경로가 태스크를 조용히 흘려도 여기서 걸린다.
    expect(r.updated + r.stale + r.failed).toBe(2);
  });

  it("문서의 줄이 인덱스와 어긋나면 stale로 세고 아무것도 쓰지 않는다", async () => {
    vi.mocked(prosemirrorToMarkdown).mockReturnValue("- [ ] 그 사이 바뀐 줄\n");

    const r = await rescheduleOverdueToToday(
      [task()],
      "2026-08-24",
      FAKE_EDITOR,
    );

    expect(r).toMatchObject({ diskPaths: [], failed: 0, stale: 1, updated: 0 });
    expect(previewTaskFieldLine).not.toHaveBeenCalled();
    // stale 하나뿐이면 커밋도 없어야 한다 — 빈 변경으로 탭을 dirty로 만들지 않는다.
    expect(useFileStore.getState().openFiles.size).toBe(0);
  });
});

describe("rescheduleOverdueToToday — 분류와 커밋 사이에 라우팅이 바뀔 때", () => {
  it("탭이 clean해지면 문서 태스크를 조용히 버리지 않고 디스크로 보낸다", async () => {
    // 분류 시점에는 탭이 dirty라 앞의 두 태스크가 문서 경로로 빠진다. 그 뒤
    // 디스크 태스크의 IPC 왕복 동안 자동 저장 디바운스가 만료되거나 사용자가
    // Cmd+S를 눌러 탭이 clean해지면 커밋 시점의 재판정이 `disk`를 돌려준다 —
    // 예전에는 그 두 태스크가 아무 카운터에도 잡히지 않은 채 사라졌다.
    vi.mocked(prosemirrorToMarkdown).mockReturnValue(
      "- [ ] a 📅2026-08-20\n- [ ] b 📅2026-08-21\n",
    );
    let writes = 0;
    vi.mocked(setTaskField).mockImplementation(
      (_path, _line, raw, _f, value) => {
        writes += 1;
        if (writes === 1) {
          useEditorStore.setState({ tabs: [{ ...OPEN_TAB, isDirty: false }] });
        }
        return Promise.resolve(
          raw.replace(/📅\d{4}-\d{2}-\d{2}/, `📅${value}`),
        );
      },
    );

    const tasks = [
      task({ line: 0, raw: "- [ ] a 📅2026-08-20" }),
      task({ due: "2026-08-21", line: 1, raw: "- [ ] b 📅2026-08-21" }),
      task({ path: "/v/other.md", raw: "- [ ] c 📅2026-08-20" }),
    ];
    const r = await rescheduleOverdueToToday(tasks, "2026-08-24", FAKE_EDITOR);

    // 확인 다이얼로그가 약속한 개수와 실제 결과가 어긋나면 안 된다.
    expect(r.updated + r.stale + r.failed).toBe(tasks.length);
    expect(r.updated).toBe(3);
    // 셋 다 실제로 쓰였다 — 디스크 태스크 하나 + 폴백된 문서 태스크 둘.
    expect(setTaskField).toHaveBeenCalledTimes(3);
    // 탭이 clean이므로 디스크가 진실원이다: 문서에는 아무것도 쓰지 않는다.
    expect(useFileStore.getState().openFiles.size).toBe(0);
    expect([...r.diskPaths].sort()).toEqual(["/v/note.md", "/v/other.md"]);
  });

  it("폴백 도중 탭이 다시 dirty가 되면 그 태스크는 문서로 가고 스토어가 패치된다", async () => {
    // 폴백 루프의 두 번째 태스크는 첫 번째의 IPC 왕복 **뒤에** 라우팅을 다시
    // 판정한다 — 그 사이 사용자가 다시 타이핑하면 문서 경로로 돌아간다. 그
    // 파일을 `diskPaths`에 넣으면 저장 전 내용을 다시 읽어 Major 1이 되살아난다.
    vi.mocked(prosemirrorToMarkdown).mockReturnValue(
      "- [ ] a 📅2026-08-20\n- [ ] b 📅2026-08-21\n",
    );
    let writes = 0;
    vi.mocked(setTaskField).mockImplementation(
      (_path, _line, raw, _f, value) => {
        writes += 1;
        // 1회차(디스크 태스크): 탭이 clean해져 문서 배치가 폴백된다.
        // 2회차(폴백 첫 태스크): 사용자가 다시 타이핑해 탭이 dirty가 된다.
        useEditorStore.setState({
          tabs: [{ ...OPEN_TAB, isDirty: writes === 2 }],
        });
        return Promise.resolve(
          raw.replace(/📅\d{4}-\d{2}-\d{2}/, `📅${value}`),
        );
      },
    );

    const tasks = [
      task({ line: 0, raw: "- [ ] a 📅2026-08-20" }),
      task({ due: "2026-08-21", line: 1, raw: "- [ ] b 📅2026-08-21" }),
      task({ path: "/v/other.md", raw: "- [ ] c 📅2026-08-20" }),
    ];
    useTaskStore.getState().setAll(tasks);

    const r = await rescheduleOverdueToToday(tasks, "2026-08-24", FAKE_EDITOR);

    expect(r.updated + r.stale + r.failed).toBe(tasks.length);
    // 마지막 태스크만 문서로 갔다 — 디스크 쓰기는 둘뿐이다.
    expect(setTaskField).toHaveBeenCalledTimes(2);
    expect(useFileStore.getState().openFiles.get(PATH)).toBe(
      "- [ ] a 📅2026-08-20\n- [ ] b 📅2026-08-24\n",
    );
    // 저장 전이므로 디스크를 다시 읽으면 되돌아간다 — 스토어를 직접 패치한다.
    expect(
      useTaskStore.getState().tasks.find((t) => t.line === 1),
    ).toMatchObject({ due: "2026-08-24", raw: "- [ ] b 📅2026-08-24" });
  });
});
