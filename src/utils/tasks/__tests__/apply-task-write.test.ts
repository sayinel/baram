import type { TaskEntry } from "../../../ipc/types";
import type { EditorTab } from "../../../stores/editor/editor";
import type { Editor } from "@tiptap/react";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/invoke", () => ({
  previewTaskFieldLine: vi.fn(),
  previewTaskStateLine: vi.fn(),
  setTaskField: vi.fn(),
  setTaskState: vi.fn(),
}));

vi.mock("../../../pipeline", () => ({
  prosemirrorToMarkdown: vi.fn(),
}));

import {
  previewTaskFieldLine,
  previewTaskStateLine,
  setTaskField,
  setTaskState,
} from "../../../ipc/invoke";
import { prosemirrorToMarkdown } from "../../../pipeline";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import {
  applyTaskWrite,
  isDiskAuthoritative,
  isUnsavedWrite,
  resolveTaskWriteTarget,
} from "../apply-task-write";

const TASK: TaskEntry = {
  cancelled: null,
  created: null,
  done: null,
  due: "2026-08-30",
  indent: 0,
  line: 1,
  links: [],
  path: "/v/note.md",
  priority: 0,
  raw: "- [ ] 초안 📅2026-08-30",
  recurrence: null,
  scheduled: null,
  start: null,
  state: "todo",
  tags: [],
  text: "초안",
};

const TO_DONE = {
  kind: "state",
  newState: "done",
  recordDoneDate: true,
  today: "2026-08-24",
} as const;

// prosemirrorToMarkdown이 모킹돼 있으므로 실제 ProseMirror doc은 필요 없다 —
// 라우터는 `editor`를 truthy 마커와 `.state.doc`을 넘기는 통로로만 쓴다.
const FAKE_EDITOR = { state: { doc: {} } } as unknown as Editor;

const OPEN_TAB: EditorTab = {
  contextId: "c",
  filePath: "/v/note.md",
  id: "t1",
  isDirty: true,
  isPinned: false,
  title: "note",
};

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({
    activeTabId: null,
    sourceBufferAccess: null,
    sourceModeTabs: [],
    tabs: [],
  });
  useFileStore.setState({ openFiles: new Map() });
});

/**
 * §312 소스 버퍼 접근자를 스토어에 등록한다 — 실앱에서는 `useSourceMode`가
 * 마운트되는 동안 같은 자리를 채운다. 테스트는 그 자리에 Map 하나를 놓고
 * 라우터가 실제로 **그 Map**을 고쳤는지 본다.
 */
function registerBuffers(initial: Record<string, string>): Map<string, string> {
  const buffers = new Map(Object.entries(initial));
  useEditorStore.setState({
    sourceBufferAccess: {
      getSourceBuffer: (tabId) => buffers.get(tabId) ?? "",
      setSourceBuffer: (tabId, content) => {
        buffers.set(tabId, content);
      },
    },
  });
  return buffers;
}

describe("applyTaskWrite — 디스크 경로", () => {
  it("탭이 없으면 디스크 IPC로 보낸다", async () => {
    vi.mocked(setTaskState).mockResolvedValue(
      "- [x] 초안 📅2026-08-30 ✅2026-08-24",
    );
    const r = await applyTaskWrite(TASK, TO_DONE, null);
    expect(setTaskState).toHaveBeenCalledWith(
      "/v/note.md",
      1,
      "- [ ] 초안 📅2026-08-30",
      "done",
      true,
      "2026-08-24",
    );
    expect(r).toEqual({
      kind: "disk",
      raw: "- [x] 초안 📅2026-08-30 ✅2026-08-24",
    });
  });

  it("배경 탭(비활성)이면 dirty여도 디스크로 보낸다 — 캐시된 PM 상태가 나중에 덮어쓴다", async () => {
    useEditorStore.setState({
      activeTabId: "other",
      tabs: [OPEN_TAB],
    });
    vi.mocked(setTaskState).mockResolvedValue("- [x] 초안");
    const before = useEditorStore.getState().contentRefreshKey;

    const r = await applyTaskWrite(TASK, TO_DONE, FAKE_EDITOR);

    expect(setTaskState).toHaveBeenCalled();
    expect(prosemirrorToMarkdown).not.toHaveBeenCalled();
    expect(useEditorStore.getState().contentRefreshKey).toBe(before);
    expect(r).toEqual({ kind: "disk", raw: "- [x] 초안" });
  });

  it("활성 탭이지만 clean이면 디스크로 보낸다 — 버퍼와 디스크가 이미 같다", async () => {
    useEditorStore.setState({
      activeTabId: "t1",
      tabs: [{ ...OPEN_TAB, isDirty: false }],
    });
    vi.mocked(setTaskState).mockResolvedValue("- [x] 초안");

    const r = await applyTaskWrite(TASK, TO_DONE, FAKE_EDITOR);

    expect(setTaskState).toHaveBeenCalled();
    expect(prosemirrorToMarkdown).not.toHaveBeenCalled();
    expect(r).toEqual({ kind: "disk", raw: "- [x] 초안" });
  });

  it("활성+dirty 탭이어도 editor가 없으면 디스크로 폴백한다", async () => {
    useEditorStore.setState({ activeTabId: "t1", tabs: [OPEN_TAB] });
    vi.mocked(setTaskState).mockResolvedValue("- [x] 초안");

    const r = await applyTaskWrite(TASK, TO_DONE, null);

    expect(setTaskState).toHaveBeenCalled();
    expect(r).toEqual({ kind: "disk", raw: "- [x] 초안" });
  });

  it("IPC가 stale을 던지면 stale로 옮긴다", async () => {
    vi.mocked(setTaskState).mockRejectedValue("stale");
    // `target`은 회계용 사실이다 — 호출자가 이 파일을 다시 읽어도 되는지를 여기서 읽는다.
    expect(await applyTaskWrite(TASK, TO_DONE, null)).toEqual({
      kind: "stale",
      target: "disk",
    });
  });

  it("stale이 아닌 실패는 그대로 던진다 — 호출자가 토스트를 띄워야 한다", async () => {
    vi.mocked(setTaskState).mockRejectedValue(new Error("permission denied"));
    await expect(applyTaskWrite(TASK, TO_DONE, null)).rejects.toThrow(
      "permission denied",
    );
  });

  it("kind: field도 디스크 IPC로 보낸다", async () => {
    vi.mocked(setTaskField).mockResolvedValue("- [ ] 초안 ⏫");
    const r = await applyTaskWrite(
      TASK,
      { field: "priority", kind: "field", value: "3" },
      null,
    );
    expect(setTaskField).toHaveBeenCalledWith(
      "/v/note.md",
      1,
      "- [ ] 초안 📅2026-08-30",
      "priority",
      "3",
    );
    expect(r).toEqual({ kind: "disk", raw: "- [ ] 초안 ⏫" });
  });
});

describe("applyTaskWrite — 문서 경로 (활성 + dirty 탭)", () => {
  beforeEach(() => {
    useEditorStore.setState({ activeTabId: "t1", tabs: [OPEN_TAB] });
  });

  it("라이브 문서에서 읽어 디스크를 건드리지 않고 고친다", async () => {
    vi.mocked(prosemirrorToMarkdown).mockReturnValue(
      "머리말\n- [ ] 초안 📅2026-08-30\n꼬리말\n",
    );
    vi.mocked(previewTaskStateLine).mockResolvedValue(
      "- [x] 초안 📅2026-08-30 ✅2026-08-24",
    );

    const r = await applyTaskWrite(TASK, TO_DONE, FAKE_EDITOR);

    expect(setTaskState).not.toHaveBeenCalled();
    expect(useFileStore.getState().openFiles.get("/v/note.md")).toBe(
      "머리말\n- [x] 초안 📅2026-08-30 ✅2026-08-24\n꼬리말\n",
    );
    expect(r).toEqual({
      kind: "document",
      raw: "- [x] 초안 📅2026-08-30 ✅2026-08-24",
    });
  });

  it("탭을 dirty로 표시하고 새로고침을 요청한다", async () => {
    vi.mocked(prosemirrorToMarkdown).mockReturnValue(
      "머리말\n- [ ] 초안 📅2026-08-30\n꼬리말\n",
    );
    vi.mocked(previewTaskStateLine).mockResolvedValue("- [x] 초안");
    const before = useEditorStore.getState().contentRefreshKey;

    await applyTaskWrite(TASK, TO_DONE, FAKE_EDITOR);

    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
    expect(useEditorStore.getState().contentRefreshKey).toBe(before + 1);
  });

  it("줄이 라이브 문서와 다르면 stale — 아무것도 쓰지 않는다", async () => {
    vi.mocked(prosemirrorToMarkdown).mockReturnValue(
      "머리말\n- [ ] 다른 내용\n꼬리말\n",
    );

    const r = await applyTaskWrite(TASK, TO_DONE, FAKE_EDITOR);

    expect(r).toEqual({ kind: "stale", target: "document" });
    expect(previewTaskStateLine).not.toHaveBeenCalled();
    expect(useFileStore.getState().openFiles.size).toBe(0);
  });

  it("줄 번호가 문서 밖이면 stale", async () => {
    vi.mocked(prosemirrorToMarkdown).mockReturnValue("한 줄뿐\n");
    expect(await applyTaskWrite(TASK, TO_DONE, FAKE_EDITOR)).toEqual({
      kind: "stale",
      target: "document",
    });
  });

  it("await 도중 라이브 문서가 바뀌면(경합) 재검사에서 stale로 잡는다", async () => {
    // 첫 호출(사전 검사)은 task.raw와 일치, 두 번째 호출(사후 재검사)에서는
    // 그 사이 다른 편집이 끼어든 것처럼 달라진 문서를 돌려준다.
    vi.mocked(prosemirrorToMarkdown)
      .mockReturnValueOnce("머리말\n- [ ] 초안 📅2026-08-30\n꼬리말\n")
      .mockReturnValueOnce("머리말\n- [ ] 다른 사람이 바꿈\n꼬리말\n");
    vi.mocked(previewTaskStateLine).mockResolvedValue("- [x] 초안");

    const r = await applyTaskWrite(TASK, TO_DONE, FAKE_EDITOR);

    expect(r).toEqual({ kind: "stale", target: "document" });
    expect(useFileStore.getState().openFiles.size).toBe(0);
  });

  it("사후 재검사가 통과하면 사전에 읽은 문서가 아니라 재검사 때 읽은 최신 문서를 스플라이스한다", async () => {
    // 태스크 자신의 줄은 await 전후로 똑같다(재검사를 통과시켜 스플라이스까지
    // 도달해야 한다) — 대신 **다른** 줄이 그 사이 바뀐다. 사전에 잡아둔
    // 문서를 스플라이스하면 이 다른 줄의 편집이 조용히 사라진다.
    vi.mocked(prosemirrorToMarkdown)
      .mockReturnValueOnce("머리말\n- [ ] 초안 📅2026-08-30\n꼬리말\n")
      .mockReturnValueOnce("머리말\n- [ ] 초안 📅2026-08-30\n꼬리말 수정됨\n");
    vi.mocked(previewTaskStateLine).mockResolvedValue(
      "- [x] 초안 📅2026-08-30 ✅2026-08-24",
    );

    await applyTaskWrite(TASK, TO_DONE, FAKE_EDITOR);

    // 토글된 태스크 줄과, await 중에 끼어든 다른 줄의 편집이 둘 다 남아야 한다.
    expect(useFileStore.getState().openFiles.get("/v/note.md")).toBe(
      "머리말\n- [x] 초안 📅2026-08-30 ✅2026-08-24\n꼬리말 수정됨\n",
    );
  });

  it("kind: field도 문서 경로에서 라이브 문서를 고친다", async () => {
    vi.mocked(prosemirrorToMarkdown).mockReturnValue(
      "머리말\n- [ ] 초안 📅2026-08-30\n꼬리말\n",
    );
    vi.mocked(previewTaskFieldLine).mockResolvedValue("- [ ] 초안 ⏫");

    const r = await applyTaskWrite(
      TASK,
      { field: "priority", kind: "field", value: "3" },
      FAKE_EDITOR,
    );

    expect(setTaskField).not.toHaveBeenCalled();
    expect(previewTaskFieldLine).toHaveBeenCalledWith(
      "- [ ] 초안 📅2026-08-30",
      "priority",
      "3",
    );
    expect(r).toEqual({ kind: "document", raw: "- [ ] 초안 ⏫" });
  });
});

// §312 소스 모드 라우팅.
//
// ‼️ 소스 모드인 더티 활성 탭은 **문서 경로의 부분집합**이다. 소스 검사를 document
// 판정 뒤에 두면 영원히 도달하지 못하고, 눈에 보이는 소스 버퍼 대신 숨어 있는
// ProseMirror 문서에 스플라이스된다 — 소스 모드를 끄거나 저장하는 순간 그 편집이
// 통째로 버려진다. 아래 순서 테스트가 그 뒤집힘을 잡는다.
describe("resolveTaskWriteTarget — §312 소스 모드", () => {
  it("더티 활성 탭이 소스 모드면 문서가 아니라 소스 버퍼로 간다", () => {
    useEditorStore.setState({
      activeTabId: "t1",
      sourceModeTabs: ["t1"],
      tabs: [OPEN_TAB],
    });
    expect(resolveTaskWriteTarget("/v/note.md", FAKE_EDITOR)).toEqual({
      kind: "source",
      tabId: "t1",
    });
  });

  it("소스 모드가 아니면 기존대로 문서로 간다", () => {
    useEditorStore.setState({
      activeTabId: "t1",
      sourceModeTabs: [],
      tabs: [OPEN_TAB],
    });
    expect(resolveTaskWriteTarget("/v/note.md", FAKE_EDITOR)).toEqual({
      kind: "document",
      tabId: "t1",
    });
  });

  it("소스 모드여도 배경 탭이면 디스크다 — 활성 조건이 먼저다", () => {
    useEditorStore.setState({
      activeTabId: "other",
      sourceModeTabs: ["t1"],
      tabs: [OPEN_TAB],
    });
    expect(resolveTaskWriteTarget("/v/note.md", FAKE_EDITOR)).toEqual({
      kind: "disk",
    });
  });

  it("소스 모드여도 clean이면 디스크다 — 버퍼와 디스크가 이미 같다", () => {
    useEditorStore.setState({
      activeTabId: "t1",
      sourceModeTabs: ["t1"],
      tabs: [{ ...OPEN_TAB, isDirty: false }],
    });
    expect(resolveTaskWriteTarget("/v/note.md", FAKE_EDITOR)).toEqual({
      kind: "disk",
    });
  });

  it("소스 모드여도 editor가 없으면 디스크다", () => {
    useEditorStore.setState({
      activeTabId: "t1",
      sourceModeTabs: ["t1"],
      tabs: [OPEN_TAB],
    });
    expect(resolveTaskWriteTarget("/v/note.md", null)).toEqual({
      kind: "disk",
    });
  });
});

describe("applyTaskWrite — 소스 경로 (소스 모드인 활성 + dirty 탭)", () => {
  beforeEach(() => {
    useEditorStore.setState({
      activeTabId: "t1",
      sourceModeTabs: ["t1"],
      tabs: [OPEN_TAB],
    });
  });

  it("보이는 소스 버퍼를 고치고 PM 문서도 디스크도 건드리지 않는다", async () => {
    const buffers = registerBuffers({
      t1: "머리말\n- [ ] 초안 📅2026-08-30\n꼬리말\n",
    });
    vi.mocked(previewTaskStateLine).mockResolvedValue(
      "- [x] 초안 📅2026-08-30 ✅2026-08-24",
    );

    const r = await applyTaskWrite(TASK, TO_DONE, FAKE_EDITOR);

    expect(buffers.get("t1")).toBe(
      "머리말\n- [x] 초안 📅2026-08-30 ✅2026-08-24\n꼬리말\n",
    );
    expect(setTaskState).not.toHaveBeenCalled();
    expect(prosemirrorToMarkdown).not.toHaveBeenCalled();
    expect(r).toEqual({
      kind: "source",
      raw: "- [x] 초안 📅2026-08-30 ✅2026-08-24",
    });
  });

  it("openFiles와 contentRefreshKey는 건드리지 않는다 — 보이는 표면은 PM이 아니다", async () => {
    registerBuffers({ t1: "머리말\n- [ ] 초안 📅2026-08-30\n꼬리말\n" });
    vi.mocked(previewTaskStateLine).mockResolvedValue("- [x] 초안");
    const before = useEditorStore.getState().contentRefreshKey;

    await applyTaskWrite(TASK, TO_DONE, FAKE_EDITOR);

    expect(useFileStore.getState().openFiles.size).toBe(0);
    expect(useEditorStore.getState().contentRefreshKey).toBe(before);
  });

  // §305 디스크 경로가 지키는 것과 **같은 행렬**이다(task_cmd.rs:130-186 참조):
  // 줄바꿈 스타일과 끝 개행 유무는 같은 입력에 대해 바이트 단위로 같아야 한다.
  // 소스 경로만 여기서 어긋나면 소스 모드로 한 번 편집한 파일의 EOL이 바뀐다.
  it.each([
    [
      "LF + 끝 개행",
      "머리말\n- [ ] 초안 📅2026-08-30\n꼬리말\n",
      "머리말\n- [x] 초안\n꼬리말\n",
    ],
    [
      "CRLF + 끝 개행",
      "머리말\r\n- [ ] 초안 📅2026-08-30\r\n꼬리말\r\n",
      "머리말\r\n- [x] 초안\r\n꼬리말\r\n",
    ],
    [
      "혼합 EOL — 건드리지 않은 줄의 종결자는 그대로",
      "머리말\r\n- [ ] 초안 📅2026-08-30\n꼬리말\r\n",
      "머리말\r\n- [x] 초안\n꼬리말\r\n",
    ],
    [
      "끝 개행 없음 — 대상 줄이 마지막 줄",
      "머리말\n- [ ] 초안 📅2026-08-30",
      "머리말\n- [x] 초안",
    ],
  ])("바이트 보존: %s", async (_name, before, after) => {
    const buffers = registerBuffers({ t1: before });
    vi.mocked(previewTaskStateLine).mockResolvedValue("- [x] 초안");

    await applyTaskWrite(TASK, TO_DONE, FAKE_EDITOR);

    expect(buffers.get("t1")).toBe(after);
  });

  it("CRLF 줄의 낙관적 잠금은 통과한다 — task.raw에는 \\r이 없다", async () => {
    const buffers = registerBuffers({
      t1: "머리말\r\n- [ ] 초안 📅2026-08-30\r\n",
    });
    vi.mocked(previewTaskStateLine).mockResolvedValue("- [x] 초안");

    const r = await applyTaskWrite(TASK, TO_DONE, FAKE_EDITOR);

    expect(r.kind).toBe("source");
    expect(buffers.get("t1")).toBe("머리말\r\n- [x] 초안\r\n");
  });

  it("버퍼의 줄이 다르면 stale — 아무것도 쓰지 않는다", async () => {
    const buffers = registerBuffers({ t1: "머리말\n- [ ] 다른 내용\n" });

    const r = await applyTaskWrite(TASK, TO_DONE, FAKE_EDITOR);

    expect(r).toEqual({ kind: "stale", target: "source" });
    expect(previewTaskStateLine).not.toHaveBeenCalled();
    expect(buffers.get("t1")).toBe("머리말\n- [ ] 다른 내용\n");
  });

  it("await 도중 사용자가 소스 표면에 타이핑하면 재검사에서 stale로 잡는다", async () => {
    const buffers = registerBuffers({
      t1: "머리말\n- [ ] 초안 📅2026-08-30\n꼬리말\n",
    });
    vi.mocked(previewTaskStateLine).mockImplementation(() => {
      // preview IPC를 기다리는 사이 CodeMirror의 onChange가 버퍼를 통째로 갈아끼운다.
      buffers.set("t1", "머리말\n- [ ] 사용자가 방금 고침\n꼬리말\n");
      return Promise.resolve("- [x] 초안");
    });

    const r = await applyTaskWrite(TASK, TO_DONE, FAKE_EDITOR);

    // ‼️ `target: "source"`가 요점이다 — 이 stale은 디스크와 무관하므로 호출자가
    // 그 파일을 다시 읽으면 같은 배치가 버퍼에 만들어 둔 변경까지 되돌아간다.
    expect(r).toEqual({ kind: "stale", target: "source" });
    expect(buffers.get("t1")).toBe(
      "머리말\n- [ ] 사용자가 방금 고침\n꼬리말\n",
    );
  });

  it("접근자가 등록돼 있지 않으면 디스크로 폴백한다 — 소스 표면이 없으니 버퍼가 디스크를 덮을 일도 없다", async () => {
    useEditorStore.setState({ sourceBufferAccess: null });
    vi.mocked(setTaskState).mockResolvedValue("- [x] 초안");

    const r = await applyTaskWrite(TASK, TO_DONE, FAKE_EDITOR);

    expect(setTaskState).toHaveBeenCalled();
    expect(r).toEqual({ kind: "disk", raw: "- [x] 초안" });
  });

  it("kind: field도 소스 버퍼를 고친다", async () => {
    const buffers = registerBuffers({ t1: "- [ ] 초안 📅2026-08-30\n" });
    vi.mocked(previewTaskFieldLine).mockResolvedValue("- [ ] 초안 ⏫");

    const r = await applyTaskWrite(
      { ...TASK, line: 0 },
      { field: "priority", kind: "field", value: "3" },
      FAKE_EDITOR,
    );

    expect(setTaskField).not.toHaveBeenCalled();
    expect(buffers.get("t1")).toBe("- [ ] 초안 ⏫\n");
    expect(r).toEqual({ kind: "source", raw: "- [ ] 초안 ⏫" });
  });
});

describe("isUnsavedWrite", () => {
  // 호출자가 "이 결과가 **스토어에 패치할 새 줄을 들고 있는가**"를 묻는 유일한 자리.
  // 새 in-memory 경로가 늘 때 호출자마다 `=== "document"`를 고쳐 다니면 하나를 빠뜨리는
  // 순간 그 경로의 변경이 디스크 재읽기로 되돌아간다.
  it("문서·소스는 아직 디스크에 없다", () => {
    expect(isUnsavedWrite({ kind: "document", raw: "x" })).toBe(true);
    expect(isUnsavedWrite({ kind: "source", raw: "x" })).toBe(true);
  });

  it("stale에는 패치할 raw가 없다 — 어느 경로에서 났든", () => {
    // ‼️ 여기서 거짓이라는 것이 "그러니 디스크를 다시 읽어도 된다"는 뜻은 아니다.
    // 그 질문의 답은 isDiskAuthoritative가 따로 들고 있다(바로 아래).
    expect(isUnsavedWrite({ kind: "disk", raw: "x" })).toBe(false);
    expect(isUnsavedWrite({ kind: "stale", target: "source" })).toBe(false);
    expect(isUnsavedWrite({ kind: "stale", target: "document" })).toBe(false);
    expect(isUnsavedWrite(null)).toBe(false);
  });
});

describe("isDiskAuthoritative", () => {
  // 두 술어가 갈라지는 지점을 여기서 고정한다. 소스·문서 경로의 stale은 패치할 값도
  // 없고(위) 디스크를 다시 읽어서도 안 된다 — 그 파일의 진실은 저장되지 않은 버퍼다.
  it("소스·문서 경로의 stale은 디스크가 진실원이 아니다", () => {
    expect(isDiskAuthoritative({ kind: "stale", target: "source" })).toBe(
      false,
    );
    expect(isDiskAuthoritative({ kind: "stale", target: "document" })).toBe(
      false,
    );
    expect(isDiskAuthoritative({ kind: "document", raw: "x" })).toBe(false);
    expect(isDiskAuthoritative({ kind: "source", raw: "x" })).toBe(false);
  });

  it("디스크 경로는 성공이든 거절이든 디스크가 진실원이다", () => {
    expect(isDiskAuthoritative({ kind: "disk", raw: "x" })).toBe(true);
    expect(isDiskAuthoritative({ kind: "stale", target: "disk" })).toBe(true);
  });

  it("예외로 실패한 쓰기(null)는 디스크를 다시 읽는다", () => {
    // 무엇이 남았는지 알 수 없다 — 스토어를 사실과 맞추는 유일한 방법이 재읽기다.
    expect(isDiskAuthoritative(null)).toBe(true);
  });
});
