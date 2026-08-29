// §312 소스 모드 탭의 정리 조작 — **화면에 보이는 버퍼가 권위 있는 텍스트다**.
//
// 마크다운 소스 모드 타이핑은 일부러 `isDirty`를 세우지 않는다(tab-surface-renderers.tsx의
// `if (!isMarkdownFile(filePath)) deps.markDirty(...)`). 그래서 소스 모드로 열어 둔 마크다운
// 탭은 사용자가 WYSIWYG에서 먼저 고치지 않는 한 계속 "clean"이다 — 즉 **보통의 경우**다.
// 라우터가 그 clean을 "버퍼와 디스크가 같다"로 읽으면 확인까지 받은 삭제가 디스크로 나가고,
// 화면의 버퍼는 지운 줄을 그대로 들고 있다가 **다음 저장에서 되살린다**.
//
// ‼️ 그래서 이 파일의 단정은 "어느 함수를 불렀는가"가 아니라 **저장하고 나면 파일에 무엇이
// 남는가**다. 라우팅만 보는 단정은 저장 경로가 버퍼를 읽는다는 사실을 통과시켜 버린다.
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
import { useTaskStore } from "../../../stores/tasks/task-store";
import { useUIStore } from "../../../stores/ui/ui";
import { showConfirm } from "../../confirm-dialog";
import { runTaskTriageAction } from "../task-triage";

const EN_T = (key: string, params?: Record<string, string>) =>
  t(key, "en", params);

const NOW = new Date(2026, 7, 26);

const FAKE_EDITOR = { state: { doc: {} } } as unknown as Editor;

const INITIAL = "- [ ] 하나\n- [ ] 둘\n";

/** 디스크에 있는 파일 한 개 — `deleteTaskLine`과 저장이 실제로 쓰는 곳. */
let disk = INITIAL;

/** 탭의 소스 버퍼 — CodeMirror가 화면에 보여 주는 텍스트. */
let buffer = INITIAL;

function ctx(editor: Editor | null = null): TaskTriageContext {
  return { editor, exclude: [], now: NOW, t: EN_T };
}

/**
 * 소스 모드로 열린 마크다운 탭 하나. `isDirty`는 기본이 `false`다 — 소스 모드 타이핑이
 * dirty를 세우지 않으므로 그것이 실앱의 보통 상태다.
 */
function openSourceTab(isDirty = false): void {
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
        isDirty,
        isPinned: false,
        title: "a",
      },
    ],
  });
}

/**
 * `handleSave`가 하는 판정을 그대로 옮긴 것(use-file-operations.ts):
 * **소스 모드 탭이면 저장 대상은 ProseMirror 문서가 아니라 버퍼다.** 이 한 줄이 있어야
 * "디스크에 썼다"가 곧 "파일에 남았다"가 아니라는 사실이 테스트에 들어온다.
 */
function save(): void {
  const { activeTabId, sourceBufferAccess, sourceModeTabs } =
    useEditorStore.getState();
  if (!activeTabId || !sourceBufferAccess) return;
  if (!sourceModeTabs.includes(activeTabId)) return;
  disk = sourceBufferAccess.getSourceBuffer(activeTabId);
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
  disk = INITIAL;
  buffer = INITIAL;
  // 디스크 IPC는 진짜로 디스크를 고친다 — 그래야 "지웠는데 되살아났다"를 셀 수 있다.
  vi.mocked(deleteTaskLine).mockImplementation((_path, line, raw) => {
    const lines = disk.split("\n");
    if (lines[line] !== raw) return Promise.reject("stale");
    lines.splice(line, 1);
    disk = lines.join("\n");
    return Promise.resolve();
  });
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

describe("§312 소스 모드 탭에서 확인된 삭제", () => {
  // ‼️ 이 파일의 핵심 테스트. dirty 관문을 소스 분기에 되돌리면 삭제가 디스크로 나가고
  // 저장이 버퍼로 그것을 되돌려 놓는다 — 여기서 `disk`가 원본으로 돌아온다.
  it("clean 탭이어도 다음 저장에서 살아남는다 — 지운 줄이 파일에 돌아오지 않는다", async () => {
    openSourceTab();
    useTaskStore.getState().setAll([task()]);

    await runTaskTriageAction("delete", task(), ctx(FAKE_EDITOR));
    save();

    expect(disk).toBe("- [ ] 둘\n");
  });

  it("clean 탭에서도 보이는 버퍼를 고친다 — 화면과 파일이 갈라지지 않는다", async () => {
    openSourceTab();
    useTaskStore.getState().setAll([task()]);

    await runTaskTriageAction("delete", task(), ctx(FAKE_EDITOR));

    expect(buffer).toBe("- [ ] 둘\n");
    expect(deleteTaskLine).not.toHaveBeenCalled();
    // 저장 전 경로는 디스크를 다시 읽지 않는다 — 읽으면 지운 줄이 되살아난다.
    expect(getFileTasks).not.toHaveBeenCalled();
  });

  // 저장 전 버퍼에만 있는 변경은 dirty 표시가 없으면 사용자에게 아무 흔적도 남기지 않는다:
  // 저장하지 않고 탭을 닫아도 확인을 받지 못하고, 외부 변경이 오면 충돌 모달 대신 조용한
  // 자동 리로드 경로로 간다. 문서 경로가 이미 하는 일과 같다.
  it("탭을 dirty로 표시한다 — 저장하지 않고 닫으면 확인을 받아야 한다", async () => {
    openSourceTab();
    useTaskStore.getState().setAll([task()]);

    await runTaskTriageAction("delete", task(), ctx(FAKE_EDITOR));

    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
  });

  it("dirty 탭에서는 예전과 같다 — 버퍼로 가고 저장이 그것을 쓴다", async () => {
    openSourceTab(true);
    useTaskStore.getState().setAll([task()]);

    await runTaskTriageAction("delete", task(), ctx(FAKE_EDITOR));
    save();

    expect(disk).toBe("- [ ] 둘\n");
  });

  // 소스 분기는 `editor`를 한 번도 읽지 않는다(`sourceBufferAccess`만 쓴다). 그것을
  // 요구하면 Tiptap 표면이 없는 순간마다 삭제가 디스크로 새고, 같은 방식으로 되돌아간다.
  it("editor가 없어도 버퍼로 간다 — 소스 경로는 라이브 문서를 읽지 않는다", async () => {
    openSourceTab();
    useTaskStore.getState().setAll([task()]);

    await runTaskTriageAction("delete", task(), ctx(null));
    save();

    expect(buffer).toBe("- [ ] 둘\n");
    expect(disk).toBe("- [ ] 둘\n");
    expect(deleteTaskLine).not.toHaveBeenCalled();
  });

  // 편집 조작도 같은 분기를 지난다 — 삭제만 덮으면 그 절반이 비어 있고, 날짜 부여의
  // 손실은 조용하다(확인 대화상자도 없다).
  it("날짜 부여도 clean 탭의 버퍼로 가고 저장에서 살아남는다", async () => {
    openSourceTab();
    useTaskStore.getState().setAll([task()]);

    await runTaskTriageAction("dueToday", task(), ctx(FAKE_EDITOR));
    save();

    expect(disk).toBe("- [ ] 하나 📅2026-08-26\n- [ ] 둘\n");
    expect(setTaskField).not.toHaveBeenCalled();
  });

  it("날짜 부여도 탭을 dirty로 표시한다", async () => {
    openSourceTab();
    useTaskStore.getState().setAll([task()]);

    await runTaskTriageAction("dueToday", task(), ctx(FAKE_EDITOR));

    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
  });

  // 배경 탭의 버퍼도 살아 있고(`syncSourceBuffers`가 갈라진 버퍼를 **보존한다**),
  // 사용자가 그 탭으로 돌아와 저장하면 그것이 파일이 된다. 그동안 디스크에 쓴 것은
  // 활성 탭일 때와 똑같이 되돌아간다.
  it("배경 소스 탭의 버퍼도 권위가 있다 — 그 탭으로 돌아와 저장해도 살아남는다", async () => {
    openSourceTab();
    useEditorStore.setState({ activeTabId: "other" });
    useTaskStore.getState().setAll([task()]);

    await runTaskTriageAction("delete", task(), ctx(FAKE_EDITOR));

    // 사용자가 그 탭으로 돌아와 저장한다.
    useEditorStore.setState({ activeTabId: "t1" });
    save();

    expect(disk).toBe("- [ ] 둘\n");
  });
});
