// §312 줄 삭제 — 확인 관문과 세 경로(디스크·소스 버퍼·문서)의 회계.
//
// 이 슬라이스의 유일한 **파괴적** 조작이고 되돌릴 수 없다(스냅샷 §71은 파일 단위이고 이
// 경로를 타지 않는다). 그래서 다른 정리 조작보다 두 가지를 더 못 박는다:
// - **확인 전에는 어떤 IPC도 나가지 않는다.** 순서를 뒤집으면 아래 두 테스트가 빨간불이다.
// - 성공은 `raw` 하나를 갈아끼우는 것이 아니라 **줄 번호를 무효화한다** — 지운 줄보다
//   아래에 있던 모든 태스크의 `line`이 하나씩 올라온다.
//
// 메뉴 항목의 수명·포커스는 `components/tasks/__tests__/task-row-menu.test.tsx`가 본다.
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

vi.mock("../../../pipeline", () => ({
  prosemirrorToMarkdown: vi.fn(),
}));

vi.mock("../../confirm-dialog", () => ({
  showConfirm: vi.fn(),
}));

import { t } from "../../../i18n";
import { deleteTaskLine, getFileTasks } from "../../../ipc/invoke";
import { prosemirrorToMarkdown } from "../../../pipeline";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { useTaskStore } from "../../../stores/tasks/task-store";
import { useUIStore } from "../../../stores/ui/ui";
import { showConfirm } from "../../confirm-dialog";
import { buildTriageItems, runTaskTriageAction } from "../task-triage";

const EN_T = (key: string, params?: Record<string, string>) =>
  t(key, "en", params);

const NOW = new Date(2026, 7, 26);

// prosemirrorToMarkdown이 모킹돼 있으므로 실제 ProseMirror doc은 필요 없다.
const FAKE_EDITOR = { state: { doc: {} } } as unknown as Editor;

function ctx(editor: Editor | null = null): TaskTriageContext {
  return { editor, exclude: [], now: NOW, t: EN_T };
}

/** 모든 마이크로태스크를 흘린다 — "아직 부르지 않았다"를 믿을 수 있게 하는 조건. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** WYSIWYG 탭 하나 — 라이브 ProseMirror 문서가 권위 있는 텍스트인 상태. */
function openDocumentTab(markdown: string): void {
  vi.mocked(prosemirrorToMarkdown).mockReturnValue(markdown);
  useEditorStore.setState({
    activeTabId: "t1",
    sourceBufferAccess: null,
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
}

/** 소스 모드 탭 하나 — 화면에 보이는 것이 CodeMirror 버퍼인 상태. */
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

describe("§312 삭제 메뉴 항목", () => {
  it("파괴적 항목으로 표시된다 — 색과 구분선의 근거는 이 한 필드다", () => {
    const item = buildTriageItems(EN_T, task()).find((i) => i.id === "delete");
    expect(item?.danger).toBe(true);
    expect(item?.label).toBe(EN_T("tasks.triage.delete"));
  });

  it("메뉴의 마지막 항목이다 — 커서가 지나가다 멈추는 자리가 아니어야 한다", () => {
    const items = buildTriageItems(EN_T, task());
    expect(items[items.length - 1].id).toBe("delete");
  });
});

describe("§312 확인 관문", () => {
  // ‼️ 이 테스트가 지키는 것: 확인과 쓰기의 **순서**. 둘을 뒤집으면 취소해도 줄이 이미
  // 사라져 있고, 삭제는 되돌릴 수 없으므로 사용자가 복구할 방법이 없다.
  it("취소하면 아무것도 쓰지 않는다", async () => {
    vi.mocked(showConfirm).mockResolvedValue(false);
    const buffer = openSourceTab("- [ ] 하나\n");
    useTaskStore.getState().setAll([task()]);

    await runTaskTriageAction("delete", task(), ctx(FAKE_EDITOR));

    expect(deleteTaskLine).not.toHaveBeenCalled();
    expect(buffer.read()).toBe("- [ ] 하나\n");
    expect(useTaskStore.getState().tasks).toHaveLength(1);
  });

  it("확인 대화상자가 열려 있는 동안에는 IPC가 나가지 않는다", async () => {
    let answer!: (v: boolean) => void;
    vi.mocked(showConfirm).mockReturnValue(
      new Promise<boolean>((resolve) => {
        answer = resolve;
      }),
    );

    const running = runTaskTriageAction("delete", task(), ctx());
    await flush();
    // 순서를 뒤집으면 여기서 이미 불려 있다.
    expect(deleteTaskLine).not.toHaveBeenCalled();

    answer(true);
    await running;
    expect(deleteTaskLine).toHaveBeenCalledTimes(1);
  });

  it("지울 줄의 원문을 문구에 담는다 — 무엇이 사라지는지 보이지 않으면 확인이 아니다", async () => {
    await runTaskTriageAction(
      "delete",
      task({ raw: "  - [ ] 회의 준비 📅2026-08-30" }),
      ctx(),
    );

    expect(vi.mocked(showConfirm).mock.calls[0][0]).toContain(
      "- [ ] 회의 준비 📅2026-08-30",
    );
  });

  // 들여쓰기만 다른 부모/하위 항목은 `text`로는 구별되지 않는다 — 문구에 들어가는 `raw`가
  // 앞 공백을 그대로 지니고 있어야 사용자가 어느 쪽을 지우는지 알 수 있다. `.trim()`으로
  // 되돌리면 이 테스트가 빨간불이 된다.
  it("들여쓰기가 있는 줄은 확인 문구에서도 들여쓰기를 유지한다 — 부모/하위 항목을 구별하는 유일한 단서", async () => {
    await runTaskTriageAction(
      "delete",
      task({ raw: "  - [ ] 하위 항목" }),
      ctx(),
    );

    expect(vi.mocked(showConfirm).mock.calls[0][0]).toBe(
      EN_T("tasks.triage.deleteConfirm", { line: "  - [ ] 하위 항목" }),
    );
  });

  // 위 테스트가 "앞 공백을 지운다"만 잡아내지 못하게 막는 짝 — 들여쓰기가 없던 줄에
  // 없던 공백이 새로 생기면 이 테스트가 빨간불이 된다.
  it("들여쓰기가 없는 줄은 그대로 남는다 — 없던 공백이 새로 생기지 않는다", async () => {
    await runTaskTriageAction("delete", task({ raw: "- [ ] 하나" }), ctx());

    expect(vi.mocked(showConfirm).mock.calls[0][0]).toBe(
      EN_T("tasks.triage.deleteConfirm", { line: "- [ ] 하나" }),
    );
  });

  it("뒤 공백은 여전히 잘린다 — 앞 들여쓰기만 남긴다", async () => {
    await runTaskTriageAction(
      "delete",
      task({ raw: "  - [ ] 하위 항목   " }),
      ctx(),
    );

    expect(vi.mocked(showConfirm).mock.calls[0][0]).toBe(
      EN_T("tasks.triage.deleteConfirm", { line: "  - [ ] 하위 항목" }),
    );
  });
});

describe("§312 디스크 경로", () => {
  it("낙관적 잠금 인자를 그대로 넘긴다", async () => {
    await runTaskTriageAction("delete", task({ line: 3 }), ctx());

    // ‼️ deleteTaskLine은 위치 인자다(src/ipc/task.ts).
    expect(deleteTaskLine).toHaveBeenCalledWith("a.md", 3, "- [ ] 하나");
  });

  // 지운 줄보다 아래에 있던 태스크의 `line`이 전부 어긋나므로 `patchTask`로는 때울 수
  // 없다 — 그 파일을 통째로 다시 읽는다.
  it("그 파일만 다시 읽는다", async () => {
    await runTaskTriageAction("delete", task(), ctx());

    expect(getFileTasks).toHaveBeenCalledWith("a.md", null, []);
  });

  it("stale은 조용히 재스캔만 한다 — 오류 토스트를 띄우지 않는다", async () => {
    vi.mocked(deleteTaskLine).mockRejectedValue("stale");

    await runTaskTriageAction("delete", task(), ctx());

    expect(getFileTasks).toHaveBeenCalledWith("a.md", null, []);
    expect(useUIStore.getState().toast).toBeNull();
  });

  it("stale이 아닌 실패는 토스트로 알린다", async () => {
    vi.mocked(deleteTaskLine).mockRejectedValue(
      "Permission denied (os error 13)",
    );

    await runTaskTriageAction("delete", task(), ctx());

    expect(useUIStore.getState().toast?.type).toBe("error");
  });
});

describe("§312 저장 전 버퍼에서의 삭제", () => {
  it("보이는 버퍼에서 줄을 지우고 디스크는 건드리지 않는다", async () => {
    const buffer = openSourceTab("- [ ] 하나\n- [ ] 둘\n");
    useTaskStore.getState().setAll([task()]);

    await runTaskTriageAction("delete", task(), ctx(FAKE_EDITOR));

    expect(buffer.read()).toBe("- [ ] 둘\n");
    expect(deleteTaskLine).not.toHaveBeenCalled();
    expect(getFileTasks).not.toHaveBeenCalled();
  });

  // 디스크 경로(write.rs)와 같은 행렬을 여기서도 한 번 지난다 — 배관이 `removeLine`을
  // 부르지 않고 직접 자르기 시작하면 프리미티브 테스트만으로는 잡히지 않는다.
  it("CRLF와 끝 개행 없음을 그대로 보존한다", async () => {
    const buffer = openSourceTab("a\r\n- [ ] 하나");
    useTaskStore.getState().setAll([task({ line: 1 })]);

    await runTaskTriageAction("delete", task({ line: 1 }), ctx(FAKE_EDITOR));

    expect(buffer.read()).toBe("a\r\n");
  });

  it("문서 경로는 라이브 문서에서 지우고 탭을 더티로 둔다", async () => {
    openDocumentTab("- [ ] 하나\n- [ ] 둘\n");
    useTaskStore.getState().setAll([task()]);
    const before = useEditorStore.getState().contentRefreshKey;

    await runTaskTriageAction("delete", task(), ctx(FAKE_EDITOR));

    expect(useFileStore.getState().openFiles.get("a.md")).toBe("- [ ] 둘\n");
    // 표면을 다시 채우지 않으면 지운 줄이 화면에 그대로 남는다.
    expect(useEditorStore.getState().contentRefreshKey).not.toBe(before);
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
    expect(deleteTaskLine).not.toHaveBeenCalled();
    expect(getFileTasks).not.toHaveBeenCalled();
  });

  // 저장 전 경로에서 디스크를 다시 읽으면 지운 줄이 되살아나고, 같은 세션이 그 버퍼에
  // 만들어 둔 **다른 줄의** 변경까지 옛 디스크 내용으로 되돌아간다.
  it("스토어에서 그 항목을 빼고 아래 줄 번호를 하나씩 올린다", async () => {
    openSourceTab("- [ ] 하나\n- [ ] 둘\n- [ ] 셋\n");
    useTaskStore
      .getState()
      .setAll([
        task({ line: 0 }),
        task({ line: 1, raw: "- [ ] 둘", text: "둘" }),
        task({ line: 2, raw: "- [ ] 셋", text: "셋" }),
        task({ line: 7, path: "b.md" }),
      ]);

    await runTaskTriageAction(
      "delete",
      task({ line: 1, raw: "- [ ] 둘", text: "둘" }),
      ctx(FAKE_EDITOR),
    );

    const { tasks } = useTaskStore.getState();
    expect(
      tasks
        .filter((x) => x.path === "a.md")
        .map((x) => [x.line, x.text])
        .sort((l, r) => Number(l[0]) - Number(r[0])),
    ).toEqual([
      [0, "하나"],
      [1, "셋"],
    ]);
    // 다른 파일은 건드리지 않는다.
    expect(tasks.find((x) => x.path === "b.md")?.line).toBe(7);
    expect(getFileTasks).not.toHaveBeenCalled();
  });

  it("버퍼가 그 사이 바뀌어 거절되면 다시 읽지 않고 알린다", async () => {
    const buffer = openSourceTab("- [ ] 사용자가 이미 고쳐 둔 줄\n");
    useTaskStore.getState().setAll([task()]);

    await runTaskTriageAction("delete", task(), ctx(FAKE_EDITOR));

    expect(useUIStore.getState().toast?.type).toBe("info");
    expect(buffer.read()).toBe("- [ ] 사용자가 이미 고쳐 둔 줄\n");
    expect(getFileTasks).not.toHaveBeenCalled();
    expect(useTaskStore.getState().tasks).toHaveLength(1);
  });

  // 접근자 미등록은 경합이 아니라 "쓸 버퍼가 존재하지 않는다"다 — 디스크로 흘러야 한다.
  it("소스 버퍼 접근자가 없으면 디스크로 폴백한다", async () => {
    openSourceTab("- [ ] 하나\n");
    useEditorStore.setState({ sourceBufferAccess: null });

    await runTaskTriageAction("delete", task(), ctx(FAKE_EDITOR));

    expect(deleteTaskLine).toHaveBeenCalledWith("a.md", 0, "- [ ] 하나");
  });
});

// §312 확인 관문의 **재진입**. 관문은 `await`이므로 그 사이에 같은 조작이 한 번 더 들어올
// 수 있고, 그러면 대화상자가 둘 쌓인다. 둘 다 확인하면 같은 인자로 `deleteTaskLine`이 두
// 번 나가는데 — 낙관적 잠금이 보는 것은 `(줄 번호, 원문)`뿐이라 **바이트가 같은 이웃 줄이
// 하나라도 있으면 통과한다.** 결과는 잘못된 값이 아니라 사용자가 지우라고 한 적 없는
// 줄이 함께 사라지는 것이고, 이 조작에는 되돌릴 통로가 없다.
//
// ‼️ 잠금을 조작 안에 두는 이유: 지금까지 이것을 막아 온 것은 `showConfirm`이 rAF에서
// 취소 버튼에 주는 포커스뿐이었다 — 다른 네 호출부와 공유하는 대화상자 헬퍼의 부수효과이고,
// 이 파일 어디에도 그 의존이 적혀 있지 않았다. 포커스는 잠금이 아니다(창이 숨으면 rAF는
// 지연되고, 행을 직접 겨냥한 dispatch는 포커스와 무관하다).
describe("§312 확인 관문은 재진입하지 않는다", () => {
  /** 낙관적 잠금까지 흉내 내는 가짜 파일 — 무엇이 남는지를 바이트로 본다. */
  function fakeDiskFile(initial: string): { read: () => string } {
    let file = initial;
    vi.mocked(deleteTaskLine).mockImplementation(
      async (_path: string, line: number, raw: string) => {
        const lines = file.split("\n");
        // 실제 `delete_line`과 같은 판정 — 바이트가 같으면 다른 줄이어도 통과한다.
        if (lines[line] !== raw) throw "stale";
        lines.splice(line, 1);
        file = lines.join("\n");
      },
    );
    return { read: () => file };
  }

  it("한 프레임 안의 두 번째 삭제는 아무것도 지우지 않는다 — 바이트가 같은 이웃 줄이 함께 사라지지 않는다", async () => {
    const disk = fakeDiskFile("- [ ] 둘\n- [ ] 둘\n- [ ] 셋\n");
    const target = task({ line: 0, raw: "- [ ] 둘", text: "둘" });
    useTaskStore
      .getState()
      .setAll([target, task({ line: 1, raw: "- [ ] 둘", text: "둘" })]);

    await Promise.all([
      runTaskTriageAction("delete", target, ctx()),
      runTaskTriageAction("delete", target, ctx()),
    ]);

    // 잠금이 없으면 두 호출 모두 잠금을 통과해 두 줄이 사라진다("- [ ] 셋\n").
    expect(disk.read()).toBe("- [ ] 둘\n- [ ] 셋\n");
    expect(deleteTaskLine).toHaveBeenCalledTimes(1);
    expect(showConfirm).toHaveBeenCalledTimes(1);
  });

  it("앞선 삭제가 끝나면 다음 삭제는 정상으로 진행한다 — 잠금이 걸린 채 남지 않는다", async () => {
    const disk = fakeDiskFile("- [ ] 둘\n- [ ] 셋\n");
    useTaskStore.getState().setAll([task({ line: 0, raw: "- [ ] 둘" })]);

    await runTaskTriageAction(
      "delete",
      task({ line: 0, raw: "- [ ] 둘" }),
      ctx(),
    );
    await runTaskTriageAction(
      "delete",
      task({ line: 0, raw: "- [ ] 셋" }),
      ctx(),
    );

    expect(disk.read()).toBe("");
    expect(deleteTaskLine).toHaveBeenCalledTimes(2);
  });

  // 취소도 잠금을 풀어야 한다 — 풀지 않으면 한 번 취소한 사용자가 그 세션에서 다시는
  // 지울 수 없다(조용히 먹지 않는 키).
  it("취소한 뒤에도 다시 지울 수 있다", async () => {
    const disk = fakeDiskFile("- [ ] 둘\n");
    useTaskStore.getState().setAll([task({ line: 0, raw: "- [ ] 둘" })]);

    vi.mocked(showConfirm).mockResolvedValueOnce(false);
    await runTaskTriageAction(
      "delete",
      task({ line: 0, raw: "- [ ] 둘" }),
      ctx(),
    );
    expect(disk.read()).toBe("- [ ] 둘\n");

    await runTaskTriageAction(
      "delete",
      task({ line: 0, raw: "- [ ] 둘" }),
      ctx(),
    );
    expect(disk.read()).toBe("");
  });

  // 쓰기가 예외로 끝나도 마찬가지다 — `finally`가 없으면 권한 오류 한 번이 삭제를 영구히
  // 잠근다.
  it("쓰기가 실패한 뒤에도 다시 지울 수 있다", async () => {
    vi.mocked(deleteTaskLine).mockRejectedValueOnce(
      "Permission denied (os error 13)",
    );
    useTaskStore.getState().setAll([task()]);

    await runTaskTriageAction("delete", task(), ctx());
    expect(useUIStore.getState().toast?.type).toBe("error");

    vi.mocked(deleteTaskLine).mockResolvedValueOnce(undefined);
    await runTaskTriageAction("delete", task(), ctx());

    expect(deleteTaskLine).toHaveBeenCalledTimes(2);
  });
});
