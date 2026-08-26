// §312 `#someday` 토글 — 메뉴 라벨과 세 경로(디스크·소스 버퍼·문서)의 회계.
//
// 메뉴 자체의 수명·포커스는 `components/tasks/__tests__/task-row-menu.test.tsx`가 본다.
// 여기서 보는 것은 그 아래 — 어떤 쓰기가 나가고, 저장 전 경로에서 스토어에 무엇이
// 남는가다. React 없이 검증할 수 있는 절반이라 순수 모듈 쪽에 둔다.
import type { TaskEntry } from "../../../ipc/types";
import type { TaskTriageContext } from "../task-triage";
import type { Editor } from "@tiptap/react";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/invoke", () => ({
  getFileTasks: vi.fn(),
  getVaultTasks: vi.fn(),
  previewTaskFieldLine: vi.fn(),
  previewTaskStateLine: vi.fn(),
  previewTaskTagLine: vi.fn(),
  setTaskField: vi.fn(),
  setTaskState: vi.fn(),
  setTaskTag: vi.fn(),
}));

vi.mock("../../../pipeline", () => ({
  prosemirrorToMarkdown: vi.fn(),
}));

import { t } from "../../../i18n";
import {
  getFileTasks,
  previewTaskTagLine,
  setTaskTag,
} from "../../../ipc/invoke";
import { useEditorStore } from "../../../stores/editor/editor";
import { useTaskStore } from "../../../stores/tasks/task-store";
import { useUIStore } from "../../../stores/ui/ui";
import { SOMEDAY_TAG } from "../task-filters";
import { buildTriageItems, runTaskTriageAction } from "../task-triage";

const EN_T = (key: string, params?: Record<string, string>) =>
  t(key, "en", params);

const NOW = new Date(2026, 7, 26);

// prosemirrorToMarkdown이 모킹돼 있으므로 실제 ProseMirror doc은 필요 없다.
const FAKE_EDITOR = { state: { doc: {} } } as unknown as Editor;

function ctx(editor: Editor | null = null): TaskTriageContext {
  return { editor, exclude: [], now: NOW, rootPath: null, t: EN_T };
}

function itemFor(entry: TaskEntry) {
  return buildTriageItems(EN_T, entry).find((i) => i.id === "someday");
}

/** 소스 모드 탭 하나를 세운다 — 화면에 보이는 것이 CodeMirror 버퍼인 상태. */
function openSourceTab(initial: string): { read: () => string } {
  let buffer = initial;
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
  return { read: () => buffer };
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
  vi.mocked(getFileTasks).mockResolvedValue([]);
  useTaskStore.getState().clear();
  useUIStore.getState().dismissToast();
  useEditorStore.setState({
    activeTabId: null,
    sourceBufferAccess: null,
    sourceModeTabs: [],
    tabs: [],
  });
});

describe("§312 someday 메뉴 항목", () => {
  it("태그가 없는 행에는 미루기를, 있는 행에는 해제를 보인다", () => {
    expect(itemFor(task())?.label).toBe(EN_T("tasks.triage.someday"));
    expect(itemFor(task({ tags: [SOMEDAY_TAG] }))?.label).toBe(
      EN_T("tasks.triage.somedayOff"),
    );
  });

  // 라벨이 갈리는데 항목 id가 갈리면 디스패처가 두 벌이 된다 — 토글은 하나다.
  it("두 상태가 같은 액션 id를 쓴다", () => {
    expect(itemFor(task())?.id).toBe("someday");
    expect(itemFor(task({ tags: [SOMEDAY_TAG] }))?.id).toBe("someday");
  });
});

describe("§312 someday 토글", () => {
  it("태그가 없으면 켜서 쓴다", async () => {
    vi.mocked(setTaskTag).mockResolvedValue("- [ ] 하나 #someday");

    await runTaskTriageAction("someday", task(), ctx());

    // ‼️ setTaskTag는 위치 인자다(src/ipc/task.ts) — 객체가 아니다.
    expect(setTaskTag).toHaveBeenCalledWith(
      "a.md",
      0,
      "- [ ] 하나",
      "someday",
      true,
    );
  });

  it("태그가 있으면 꺼서 쓴다", async () => {
    vi.mocked(setTaskTag).mockResolvedValue("- [ ] 하나");

    await runTaskTriageAction(
      "someday",
      task({
        raw: "- [ ] 하나 #someday",
        tags: [SOMEDAY_TAG],
        text: "하나 #someday",
      }),
      ctx(),
    );

    expect(setTaskTag).toHaveBeenCalledWith(
      "a.md",
      0,
      "- [ ] 하나 #someday",
      "someday",
      false,
    );
  });

  it("디스크에 썼으면 그 파일만 다시 읽는다", async () => {
    vi.mocked(setTaskTag).mockResolvedValue("- [ ] 하나 #someday");

    await runTaskTriageAction("someday", task(), ctx());

    expect(getFileTasks).toHaveBeenCalledWith("a.md", null, []);
  });

  it("stale은 조용히 재스캔만 한다 — 오류 토스트를 띄우지 않는다", async () => {
    vi.mocked(setTaskTag).mockRejectedValue("stale");

    await runTaskTriageAction("someday", task(), ctx());

    expect(getFileTasks).toHaveBeenCalledWith("a.md", null, []);
    expect(useUIStore.getState().toast).toBeNull();
  });

  it("stale이 아닌 실패는 토스트로 알린다", async () => {
    vi.mocked(setTaskTag).mockRejectedValue("Permission denied (os error 13)");

    await runTaskTriageAction("someday", task(), ctx());

    expect(useUIStore.getState().toast?.type).toBe("error");
  });
});

describe("§312 저장 전 버퍼에서의 토글", () => {
  it("보이는 버퍼에 쓰고 디스크는 건드리지 않는다", async () => {
    const buffer = openSourceTab("- [ ] 하나\n");
    vi.mocked(previewTaskTagLine).mockResolvedValue("- [ ] 하나 #someday");
    useTaskStore.getState().setAll([task()]);

    await runTaskTriageAction("someday", task(), ctx(FAKE_EDITOR));

    expect(buffer.read()).toBe("- [ ] 하나 #someday\n");
    expect(setTaskTag).not.toHaveBeenCalled();
    expect(getFileTasks).not.toHaveBeenCalled();
  });

  it("다시 읽지 않고 스토어의 raw와 tags를 제자리에서 갱신한다", async () => {
    openSourceTab("- [ ] 하나\n");
    vi.mocked(previewTaskTagLine).mockResolvedValue("- [ ] 하나 #someday");
    useTaskStore.getState().setAll([task()]);

    await runTaskTriageAction("someday", task(), ctx(FAKE_EDITOR));

    const [entry] = useTaskStore.getState().tasks;
    expect(entry.raw).toBe("- [ ] 하나 #someday");
    expect(entry.tags).toEqual(["someday"]);
    expect(getFileTasks).not.toHaveBeenCalled();
  });

  // 파서는 태그를 본문에 **남긴 채** 수집만 한다(parse.rs) — 아젠다 행은 그 본문을
  // 그린다. `tags`만 갈아끼우면 해제한 태그가 행에는 그대로 보여 "먹지 않았다"로 읽힌다.
  it("행에 보이는 본문에서도 태그가 사라진다", async () => {
    const tagged = task({
      raw: "- [ ] 하나 #someday",
      tags: [SOMEDAY_TAG],
      text: "하나 #someday",
    });
    openSourceTab("- [ ] 하나 #someday\n");
    vi.mocked(previewTaskTagLine).mockResolvedValue("- [ ] 하나");
    useTaskStore.getState().setAll([tagged]);

    await runTaskTriageAction("someday", tagged, ctx(FAKE_EDITOR));

    const [entry] = useTaskStore.getState().tasks;
    expect(entry.text).toBe("하나");
    expect(entry.tags).toEqual([]);
  });

  it("켤 때는 본문 끝에 태그가 붙는다", async () => {
    openSourceTab("- [ ] 하나\n");
    vi.mocked(previewTaskTagLine).mockResolvedValue("- [ ] 하나 #someday");
    useTaskStore.getState().setAll([task()]);

    await runTaskTriageAction("someday", task(), ctx(FAKE_EDITOR));

    expect(useTaskStore.getState().tasks[0].text).toBe("하나 #someday");
  });

  // ‼️ 이 stale은 디스크와 무관하다. 다시 읽으면 같은 세션이 그 버퍼에 이미 만들어 둔
  // **다른 줄의** 변경까지 옛 디스크 내용으로 되돌아간다.
  it("버퍼가 그 사이 바뀌어 거절되면 다시 읽지 않고 알린다", async () => {
    openSourceTab("- [ ] 사용자가 이미 고쳐 둔 줄\n");
    vi.mocked(previewTaskTagLine).mockResolvedValue("- [ ] 하나 #someday");
    useTaskStore.getState().setAll([task()]);

    await runTaskTriageAction("someday", task(), ctx(FAKE_EDITOR));

    expect(useUIStore.getState().toast?.type).toBe("info");
    expect(getFileTasks).not.toHaveBeenCalled();
    expect(useTaskStore.getState().tasks[0].tags).toEqual([]);
  });
});
