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
import { applyTaskWrite } from "../apply-task-write";

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
  useEditorStore.setState({ activeTabId: null, tabs: [] });
  useFileStore.setState({ openFiles: new Map() });
});

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
    expect(await applyTaskWrite(TASK, TO_DONE, null)).toEqual({
      kind: "stale",
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

    expect(r).toEqual({ kind: "stale" });
    expect(previewTaskStateLine).not.toHaveBeenCalled();
    expect(useFileStore.getState().openFiles.size).toBe(0);
  });

  it("줄 번호가 문서 밖이면 stale", async () => {
    vi.mocked(prosemirrorToMarkdown).mockReturnValue("한 줄뿐\n");
    expect(await applyTaskWrite(TASK, TO_DONE, FAKE_EDITOR)).toEqual({
      kind: "stale",
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

    expect(r).toEqual({ kind: "stale" });
    expect(useFileStore.getState().openFiles.size).toBe(0);
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
