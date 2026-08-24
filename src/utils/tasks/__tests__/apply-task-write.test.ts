import type { TaskEntry } from "../../../ipc/types";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/invoke", () => ({
  previewTaskFieldLine: vi.fn(),
  previewTaskStateLine: vi.fn(),
  setTaskField: vi.fn(),
  setTaskState: vi.fn(),
}));

import { previewTaskStateLine, setTaskState } from "../../../ipc/invoke";
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

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({ activeTabId: null, tabs: [] });
  useFileStore.setState({ openFiles: new Map() });
});

describe("applyTaskWrite — 닫힌 파일", () => {
  it("디스크 IPC로 보낸다", async () => {
    vi.mocked(setTaskState).mockResolvedValue(
      "- [x] 초안 📅2026-08-30 ✅2026-08-24",
    );
    const r = await applyTaskWrite(TASK, TO_DONE);
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

  it("IPC가 stale을 던지면 stale로 옮긴다", async () => {
    vi.mocked(setTaskState).mockRejectedValue("stale");
    expect(await applyTaskWrite(TASK, TO_DONE)).toEqual({ kind: "stale" });
  });

  it("stale이 아닌 실패는 그대로 던진다 — 호출자가 토스트를 띄워야 한다", async () => {
    vi.mocked(setTaskState).mockRejectedValue(new Error("permission denied"));
    await expect(applyTaskWrite(TASK, TO_DONE)).rejects.toThrow(
      "permission denied",
    );
  });
});

describe("applyTaskWrite — 열린 파일", () => {
  beforeEach(() => {
    useEditorStore.setState({
      activeTabId: "t1",
      tabs: [
        {
          contextId: "c",
          filePath: "/v/note.md",
          id: "t1",
          isDirty: false,
          isPinned: false,
          title: "note",
        },
      ],
    });
    useFileStore.setState({
      openFiles: new Map([
        ["/v/note.md", "머리말\n- [ ] 초안 📅2026-08-30\n꼬리말\n"],
      ]),
    });
  });

  it("디스크를 건드리지 않고 열린 내용을 고친다", async () => {
    vi.mocked(previewTaskStateLine).mockResolvedValue(
      "- [x] 초안 📅2026-08-30 ✅2026-08-24",
    );
    const r = await applyTaskWrite(TASK, TO_DONE);

    expect(setTaskState).not.toHaveBeenCalled();
    expect(useFileStore.getState().openFiles.get("/v/note.md")).toBe(
      "머리말\n- [x] 초안 📅2026-08-30 ✅2026-08-24\n꼬리말\n",
    );
    expect(r).toEqual({
      kind: "document",
      raw: "- [x] 초안 📅2026-08-30 ✅2026-08-24",
    });
  });

  it("탭을 dirty로 표시한다 — 자동 저장이 이걸 보고 저장한다", async () => {
    vi.mocked(previewTaskStateLine).mockResolvedValue("- [x] 초안");
    await applyTaskWrite(TASK, TO_DONE);
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
  });

  it("활성 탭이면 내용 새로고침을 요청한다", async () => {
    vi.mocked(previewTaskStateLine).mockResolvedValue("- [x] 초안");
    const before = useEditorStore.getState().contentRefreshKey;
    await applyTaskWrite(TASK, TO_DONE);
    expect(useEditorStore.getState().contentRefreshKey).toBe(before + 1);
  });

  it("비활성 탭이면 새로고침을 요청하지 않는다 — 활성 문서를 엉뚱하게 다시 그린다", async () => {
    useEditorStore.setState({ activeTabId: "other" });
    vi.mocked(previewTaskStateLine).mockResolvedValue("- [x] 초안");
    const before = useEditorStore.getState().contentRefreshKey;
    await applyTaskWrite(TASK, TO_DONE);
    expect(useEditorStore.getState().contentRefreshKey).toBe(before);
  });

  it("줄이 그 사이 바뀌었으면 stale — 아무것도 쓰지 않는다", async () => {
    useFileStore.setState({
      openFiles: new Map([["/v/note.md", "머리말\n- [ ] 다른 내용\n꼬리말\n"]]),
    });
    const r = await applyTaskWrite(TASK, TO_DONE);
    expect(r).toEqual({ kind: "stale" });
    expect(previewTaskStateLine).not.toHaveBeenCalled();
    expect(useFileStore.getState().openFiles.get("/v/note.md")).toBe(
      "머리말\n- [ ] 다른 내용\n꼬리말\n",
    );
  });

  it("줄 번호가 파일 밖이면 stale", async () => {
    useFileStore.setState({
      openFiles: new Map([["/v/note.md", "한 줄뿐\n"]]),
    });
    expect(await applyTaskWrite(TASK, TO_DONE)).toEqual({ kind: "stale" });
  });

  it("탭은 있지만 내용 캐시가 없으면 디스크로 폴백한다", async () => {
    useFileStore.setState({ openFiles: new Map() });
    vi.mocked(setTaskState).mockResolvedValue("- [x] 초안");
    const r = await applyTaskWrite(TASK, TO_DONE);
    expect(setTaskState).toHaveBeenCalled();
    expect(r).toEqual({ kind: "disk", raw: "- [x] 초안" });
  });

  it("CRLF 문서의 줄바꿈을 보존한다", async () => {
    useFileStore.setState({
      openFiles: new Map([
        ["/v/note.md", "머리말\r\n- [ ] 초안 📅2026-08-30\r\n꼬리말\r\n"],
      ]),
    });
    vi.mocked(previewTaskStateLine).mockResolvedValue("- [x] 초안");
    await applyTaskWrite(TASK, TO_DONE);
    expect(useFileStore.getState().openFiles.get("/v/note.md")).toBe(
      "머리말\r\n- [x] 초안\r\n꼬리말\r\n",
    );
  });
});
