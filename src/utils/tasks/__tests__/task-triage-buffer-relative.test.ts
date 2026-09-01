// §312 저장 전 삭제가 남기는 것 — **스토어의 줄 번호가 디스크가 아니라 버퍼를 가리킨다**.
//
// 편집 조작(체크·기한·태그)은 `line`을 바꾸지 않는다. 삭제만 바꾼다 — 지운 줄 아래의
// 번호를 하나씩 올린다(`dropLineFromBuffer`). 그 계산은 **저장 전 표면에 대해** 맞고
// 디스크에 대해서는 틀리다. 라우터는 조작마다 다시 판정하므로, 그 표면이 사라지는 순간
// (탭 전환·탭 닫기) 다음 조작이 **표면 기준 번호를 들고 디스크로** 간다.
//
// 그것이 왜 조용한 데이터 손실인가: 낙관적 잠금은 `(줄 번호, 원문)` 쌍만 본다. 바이트가
// 같은 이웃 줄이 하나라도 있으면 잠금이 **통과하고** 사용자가 방금 지운 그 줄에 날짜가
// 찍힌다. 아래 첫 테스트가 정확히 그 배치다.
import type { TaskEntry } from "../../../ipc/types";
import type { TaskTriageContext } from "../task-triage";
import type { Editor } from "@tiptap/react";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/invoke", () => ({
  deleteTaskLine: vi.fn(),
  getFileTasks: vi.fn(),
  getVaultTasks: vi.fn(),
  previewTaskFieldLine: vi.fn(),
  previewTaskStateLine: vi.fn(),
  previewTaskTagLine: vi.fn(),
  setTaskField: vi.fn(),
  setTaskState: vi.fn(),
  setTaskTag: vi.fn(),
}));

vi.mock("../../editor/serialize-live-doc", () => ({
  serializeLiveDoc: vi.fn(),
}));

vi.mock("../../confirm-dialog", () => ({
  showConfirm: vi.fn(),
}));

import { t } from "../../../i18n";
import {
  deleteTaskLine,
  getFileTasks,
  previewTaskFieldLine,
  setTaskField,
} from "../../../ipc/invoke";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import {
  refreshFileTasks,
  useTaskStore,
} from "../../../stores/tasks/task-store";
import { useUIStore } from "../../../stores/ui/ui";
import { showConfirm } from "../../confirm-dialog";
import { serializeLiveDoc } from "../../editor/serialize-live-doc";
import { runTaskTriageAction } from "../task-triage";

const EN_T = (key: string, params?: Record<string, string>) =>
  t(key, "en", params);

/** 아젠다가 보고 있는 날 — `dueToday`가 쓰는 값. */
const NOW = new Date(2026, 7, 26);
const TODAY = "2026-08-26";

const FAKE_EDITOR = { state: { doc: {} } } as unknown as Editor;

/** 디스크에 있는 파일 — IPC 목이 실제로 고친다. */
let disk = "";
/** 소스 모드 탭의 CodeMirror 버퍼. */
let buffer = "";

/** 사용자가 그 탭을 닫는다 — 저장 전 표면도 그 버퍼도 함께 사라진다. */
function closeTab(): void {
  useEditorStore.setState({
    activeTabId: null,
    sourceBufferAccess: null,
    sourceModeTabs: [],
    tabs: [],
  });
}

function ctx(editor: Editor | null = null): TaskTriageContext {
  return {
    editor,
    exclude: [],
    now: NOW,
    recordDoneDate: true,
    t: EN_T,
    trackTime: false,
  };
}

/**
 * WYSIWYG 탭 하나 — 라이브 ProseMirror 문서가 권위 있는 텍스트다.
 *
 * 라이브 문서는 문서 경로가 `setFileContent`로 커밋한 값을 따라간다(실앱에서는 React가
 * 커밋한 뒤 표면이 그것을 다시 읽는다). 그래야 "지우고 나서 다음 조작"이라는 순서가
 * 테스트 안에서 실제로 재현된다.
 */
function openDocumentTab(initial: string): void {
  disk = initial;
  useFileStore.setState({ openFiles: new Map([["a.md", initial]]) });
  vi.mocked(serializeLiveDoc).mockImplementation(
    () => useFileStore.getState().openFiles.get("a.md") ?? "",
  );
  useEditorStore.setState({
    activeTabId: "t1",
    sourceBufferAccess: null,
    sourceModeTabs: [],
    tabs: [tab()],
  });
}

/** 소스 모드 탭 하나 — 화면에 보이는 것이 CodeMirror 버퍼다. */
function openSourceTab(initial: string): void {
  disk = initial;
  buffer = initial;
  useEditorStore.setState({
    activeTabId: "t1",
    sourceBufferAccess: {
      getSourceBuffer: () => buffer,
      setSourceBuffer: (_tabId, next) => {
        buffer = next;
      },
    },
    sourceModeTabs: ["t1"],
    tabs: [tab({ isDirty: false })],
  });
}

/** 사용자가 다른 탭으로 넘어간다 — 이 파일의 탭은 더 이상 활성이 아니다. */
function switchAway(): void {
  useEditorStore.setState({ activeTabId: "other" });
}

function tab(over: { isDirty?: boolean } = {}) {
  return {
    contextId: "c",
    filePath: "a.md",
    id: "t1",
    isDirty: over.isDirty ?? true,
    isPinned: false,
    title: "a",
  };
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
    path: "a.md",
    priority: 0,
    raw: "- [ ] a",
    recurrence: null,
    scheduled: null,
    start: null,
    state: "todo",
    tags: [],
    text: "a",
    timer: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  disk = "";
  buffer = "";
  // 디스크 IPC는 실제로 디스크를 고친다 — 잘못된 줄에 찍힌 날짜를 눈으로 셀 수 있어야 한다.
  vi.mocked(deleteTaskLine).mockImplementation((_path, line, raw) => {
    const lines = disk.split("\n");
    if (lines[line] !== raw) return Promise.reject("stale");
    lines.splice(line, 1);
    disk = lines.join("\n");
    return Promise.resolve();
  });
  vi.mocked(setTaskField).mockImplementation(
    (_path, line, raw, _field, value) => {
      const lines = disk.split("\n");
      // §305 낙관적 잠금 — Rust와 같은 기준이다(줄 번호 + 원문).
      if (lines[line] !== raw) return Promise.reject("stale");
      const next = `${raw} 📅${value}`;
      lines[line] = next;
      disk = lines.join("\n");
      return Promise.resolve(next);
    },
  );
  vi.mocked(previewTaskFieldLine).mockImplementation((raw, _field, value) =>
    Promise.resolve(`${raw} 📅${value}`),
  );
  vi.mocked(getFileTasks).mockResolvedValue([]);
  vi.mocked(showConfirm).mockResolvedValue(true);
  useTaskStore.getState().clear();
  useUIStore.getState().dismissToast();
  useFileStore.setState({ openFiles: new Map() });
  useEditorStore.setState({
    activeTabId: null,
    sourceBufferAccess: null,
    sourceModeTabs: [],
    tabs: [],
  });
});

describe("§312 저장 전 삭제 뒤의 디스크 라우팅", () => {
  // P1b — 바이트가 같은 이웃이 잠금을 통과시킨다. 이 배치에서 손실은 조용하다:
  // 토스트도, 충돌 모달도, 실패도 없다. 사용자가 지운 줄에 날짜가 찍힐 뿐이다.
  it("바이트가 같은 이웃에 날짜를 찍지 않는다 — 사용자가 방금 지운 줄이다", async () => {
    openDocumentTab("- [ ] a\n- [ ] b\n- [ ] b\n");
    const B1 = task({ line: 1, raw: "- [ ] b", text: "b" });
    const B2 = task({ line: 2, raw: "- [ ] b", text: "b" });
    useTaskStore.getState().setAll([task(), B1, B2]);

    await runTaskTriageAction("delete", B1, ctx(FAKE_EDITOR));
    switchAway();

    // 살아남은 `b`는 이제 스토어에서 1번 줄이다 — 디스크에서는 2번 줄이다.
    const survivor = useTaskStore
      .getState()
      .tasks.find((x) => x.text === "b" && x.line === 1)!;
    await runTaskTriageAction("dueToday", survivor, ctx(FAKE_EDITOR));

    expect(disk).toBe("- [ ] a\n- [ ] b\n- [ ] b\n");
    expect(setTaskField).not.toHaveBeenCalled();
  });

  // P1a — 디스크가 진실원이 아닌데 재읽기가 돌면 지운 줄이 아젠다로 돌아온다.
  it("지운 줄이 아젠다로 돌아오지 않는다 — 디스크를 다시 읽지 않는다", async () => {
    openDocumentTab("- [ ] a\n- [ ] b\n- [ ] c\n");
    useTaskStore
      .getState()
      .setAll([
        task(),
        task({ line: 1, raw: "- [ ] b", text: "b" }),
        task({ line: 2, raw: "- [ ] c", text: "c" }),
      ]);

    await runTaskTriageAction("delete", task(), ctx(FAKE_EDITOR));
    switchAway();

    const survivor = useTaskStore.getState().tasks.find((x) => x.text === "c")!;
    await runTaskTriageAction("dueToday", survivor, ctx(FAKE_EDITOR));

    expect(getFileTasks).not.toHaveBeenCalled();
    expect(
      useTaskStore
        .getState()
        .tasks.map((x) => x.text)
        .sort(),
    ).toEqual(["b", "c"]);
  });

  // 소스 모드 탭에서는 탭을 닫는 것이 같은 자리다 — 버퍼가 사라지면서 라우터가 다시
  // 디스크를 고르는데, 스토어의 번호는 그 사라진 버퍼를 가리킨 채로 남는다.
  it("탭을 닫아도 막는다 — 버퍼는 사라졌고 번호는 그대로다", async () => {
    openSourceTab("- [ ] a\n- [ ] b\n- [ ] b\n");
    const B1 = task({ line: 1, raw: "- [ ] b", text: "b" });
    useTaskStore
      .getState()
      .setAll([task(), B1, task({ line: 2, raw: "- [ ] b", text: "b" })]);

    await runTaskTriageAction("delete", B1, ctx(FAKE_EDITOR));
    closeTab();

    const survivor = useTaskStore
      .getState()
      .tasks.find((x) => x.text === "b" && x.line === 1)!;
    await runTaskTriageAction("dueToday", survivor, ctx(FAKE_EDITOR));

    expect(disk).toBe("- [ ] a\n- [ ] b\n- [ ] b\n");
    expect(setTaskField).not.toHaveBeenCalled();
  });

  // 삭제도 같은 관문을 지난다 — 파괴적 조작에서 어긋난 번호는 **다른 줄을 지운다**.
  it("두 번째 삭제도 막는다 — 어긋난 번호로 지우면 되돌릴 수 없다", async () => {
    openSourceTab("- [ ] a\n- [ ] b\n- [ ] b\n");
    const B1 = task({ line: 1, raw: "- [ ] b", text: "b" });
    useTaskStore
      .getState()
      .setAll([task(), B1, task({ line: 2, raw: "- [ ] b", text: "b" })]);

    await runTaskTriageAction("delete", B1, ctx(FAKE_EDITOR));
    closeTab();

    const survivor = useTaskStore
      .getState()
      .tasks.find((x) => x.text === "b" && x.line === 1)!;
    await runTaskTriageAction("delete", survivor, ctx(FAKE_EDITOR));

    expect(disk).toBe("- [ ] a\n- [ ] b\n- [ ] b\n");
    expect(deleteTaskLine).not.toHaveBeenCalled();
  });

  // 침묵도 결함이다 — 이 거절은 저장할 때까지 영구적이라, 알리지 않으면 그 행이
  // 영원히 죽은 것처럼 보인다(`notifyUnsavedConflict`가 존재하는 이유).
  it("거절을 알린다 — 저장하지 않은 변경이 있다는 그 안내다", async () => {
    openDocumentTab("- [ ] a\n- [ ] b\n");
    useTaskStore
      .getState()
      .setAll([task(), task({ line: 1, raw: "- [ ] b", text: "b" })]);

    await runTaskTriageAction("delete", task(), ctx(FAKE_EDITOR));
    switchAway();

    await runTaskTriageAction(
      "dueToday",
      useTaskStore.getState().tasks[0],
      ctx(FAKE_EDITOR),
    );

    const { toast } = useUIStore.getState();
    expect(toast?.type).toBe("info");
    expect(toast?.message).toBe(EN_T("tasks.unsavedConflict"));
  });

  it("스토어를 만지지 않는다 — 쓰지 않은 값을 주장하지 않는다", async () => {
    openDocumentTab("- [ ] a\n- [ ] b\n");
    useTaskStore
      .getState()
      .setAll([task(), task({ line: 1, raw: "- [ ] b", text: "b" })]);

    await runTaskTriageAction("delete", task(), ctx(FAKE_EDITOR));
    switchAway();
    const before = useTaskStore.getState().tasks;

    await runTaskTriageAction("dueToday", before[0], ctx(FAKE_EDITOR));

    expect(useTaskStore.getState().tasks).toEqual(before);
  });

  it("삭제하지 않은 파일은 예전대로 디스크로 간다", async () => {
    openDocumentTab("- [ ] a\n- [ ] b\n");
    useTaskStore
      .getState()
      .setAll([task(), task({ line: 1, raw: "- [ ] b", text: "b" })]);
    switchAway();

    await runTaskTriageAction("dueToday", task(), ctx(FAKE_EDITOR));

    expect(disk).toBe(`- [ ] a 📅${TODAY}\n- [ ] b\n`);
  });

  // 같은 표면이 그대로 살아 있으면 번호와 그 표면이 서로 맞다 — 막을 이유가 없다.
  it("같은 표면으로 가는 다음 조작은 막지 않는다", async () => {
    openSourceTab("- [ ] a\n- [ ] b\n");
    useTaskStore
      .getState()
      .setAll([task(), task({ line: 1, raw: "- [ ] b", text: "b" })]);

    await runTaskTriageAction("delete", task(), ctx(FAKE_EDITOR));
    await runTaskTriageAction(
      "dueToday",
      useTaskStore.getState().tasks[0],
      ctx(FAKE_EDITOR),
    );

    expect(buffer).toBe(`- [ ] b 📅${TODAY}\n`);
  });

  // 저장하면 워처가 `file:changed`를 올리고 그 파일만 다시 스캔한다 — 그 순간부터
  // 스토어의 번호는 다시 디스크의 번호다. 표시가 거기서 풀리지 않으면 그 파일은
  // 세션이 끝날 때까지 디스크에 쓸 수 없다.
  it("재스캔하면 표시가 풀린다 — 저장 뒤 그 파일은 다시 디스크로 간다", async () => {
    openSourceTab("- [ ] a\n- [ ] b\n");
    useTaskStore
      .getState()
      .setAll([task(), task({ line: 1, raw: "- [ ] b", text: "b" })]);

    await runTaskTriageAction("delete", task(), ctx(FAKE_EDITOR));
    // 저장 → 워처 → 증분 재스캔. 디스크에는 이제 살아남은 줄 하나뿐이다.
    disk = buffer;
    closeTab();
    vi.mocked(getFileTasks).mockResolvedValue([
      task({ line: 0, raw: "- [ ] b", text: "b" }),
    ]);
    await refreshFileTasks("a.md", []);

    await runTaskTriageAction(
      "dueToday",
      useTaskStore.getState().tasks[0],
      ctx(FAKE_EDITOR),
    );

    expect(disk).toBe(`- [ ] b 📅${TODAY}\n`);
  });
});
