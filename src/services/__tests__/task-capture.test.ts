import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../ipc/invoke", () => ({ appendTaskLine: vi.fn() }));
vi.mock("../../utils/tasks/apply-task-write", () => ({
  resolveTaskWriteTarget: vi.fn(),
}));
vi.mock("../../pipeline", () => ({ prosemirrorToMarkdown: vi.fn() }));

import { appendTaskLine } from "../../ipc/invoke";
import { prosemirrorToMarkdown } from "../../pipeline";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { resolveTaskWriteTarget } from "../../utils/tasks/apply-task-write";
import { buildCaptureLine, captureTask } from "../task-capture";

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({ activeTabId: null, tabs: [] });
  useFileStore.setState({ openFiles: new Map() });
  vi.mocked(resolveTaskWriteTarget).mockReturnValue({ kind: "disk" });
});

describe("buildCaptureLine", () => {
  it("체크박스와 생성일을 붙인다", () => {
    expect(buildCaptureLine("우유 사기", "2026-08-24")).toBe(
      "- [ ] 우유 사기 ➕2026-08-24",
    );
  });

  it("여러 줄 본문을 한 줄로 접는다 — append는 한 줄만 받는다", () => {
    expect(buildCaptureLine("첫 줄\n둘째 줄", "2026-08-24")).toBe(
      "- [ ] 첫 줄 둘째 줄 ➕2026-08-24",
    );
  });

  it("앞뒤 공백과 연속 공백을 정리한다", () => {
    expect(buildCaptureLine("  우유   사기  ", "2026-08-24")).toBe(
      "- [ ] 우유 사기 ➕2026-08-24",
    );
  });

  it("이미 체크박스로 시작하면 두 번 붙이지 않는다", () => {
    expect(buildCaptureLine("- [ ] 우유 사기", "2026-08-24")).toBe(
      "- [ ] 우유 사기 ➕2026-08-24",
    );
  });

  it("대시 뒤에 공백이 없는 체크박스도 두 번 붙이지 않는다", () => {
    expect(buildCaptureLine("-[ ] foo", "2026-08-24")).toBe(
      "- [ ] foo ➕2026-08-24",
    );
  });

  it("체크박스가 아닌 대괄호는 건드리지 않는다 — [1]은 [ ]/[x]/[X]가 아니다", () => {
    expect(buildCaptureLine("-[1] 참고", "2026-08-24")).toBe(
      "- [ ] -[1] 참고 ➕2026-08-24",
    );
  });

  it("본문에 이미 ➕생성일이 있으면 새 날짜로 교체한다 — 두 번 붙이면 Rust 파서가 첫 마커를 취해 잘못된 생성일을 기록한다", () => {
    expect(buildCaptureLine("foo ➕2026-01-01", "2026-08-24")).toBe(
      "- [ ] foo ➕2026-08-24",
    );
  });
});

describe("captureTask — 수집함이 닫혀 있을 때", () => {
  it("절대 경로로 append한다", async () => {
    vi.mocked(appendTaskLine).mockResolvedValue("- [ ] 우유 사기 ➕2026-08-24");
    const raw = await captureTask({
      body: "우유 사기",
      captureFile: "Inbox.md",
      editor: null,
      rootPath: "/v",
      today: "2026-08-24",
    });
    expect(appendTaskLine).toHaveBeenCalledWith(
      "/v/Inbox.md",
      "- [ ] 우유 사기 ➕2026-08-24",
    );
    expect(raw).toBe("- [ ] 우유 사기 ➕2026-08-24");
  });

  it("설정값이 이미 절대 경로면 rootPath를 덧붙이지 않는다", async () => {
    vi.mocked(appendTaskLine).mockResolvedValue("x");
    await captureTask({
      body: "a",
      captureFile: "/elsewhere/In.md",
      editor: null,
      rootPath: "/v",
      today: "2026-08-24",
    });
    expect(appendTaskLine).toHaveBeenCalledWith(
      "/elsewhere/In.md",
      expect.any(String),
    );
  });

  it("빈 본문은 거절한다 — 빈 태스크를 파일에 남기지 않는다", async () => {
    await expect(
      captureTask({
        body: "   ",
        captureFile: "Inbox.md",
        editor: null,
        rootPath: "/v",
        today: "2026-08-24",
      }),
    ).rejects.toThrow();
    expect(appendTaskLine).not.toHaveBeenCalled();
  });

  it("rootPath에 트레일링 슬래시가 있어도 이중 슬래시를 만들지 않는다", async () => {
    vi.mocked(appendTaskLine).mockResolvedValue("x");
    await captureTask({
      body: "a",
      captureFile: "Inbox.md",
      editor: null,
      rootPath: "/v/",
      today: "2026-08-24",
    });
    expect(appendTaskLine).toHaveBeenCalledWith(
      "/v/Inbox.md",
      expect.any(String),
    );
  });

  it("설정값의 ./ 같은 상대 세그먼트를 정리한다", async () => {
    vi.mocked(appendTaskLine).mockResolvedValue("x");
    await captureTask({
      body: "a",
      captureFile: "./Inbox.md",
      editor: null,
      rootPath: "/v",
      today: "2026-08-24",
    });
    expect(appendTaskLine).toHaveBeenCalledWith(
      "/v/Inbox.md",
      expect.any(String),
    );
  });

  it("설정값이 빈 문자열이면 기본 파일명으로 대체한다 — 디렉터리 경로에 쓰지 않는다", async () => {
    vi.mocked(appendTaskLine).mockResolvedValue("x");
    await captureTask({
      body: "a",
      captureFile: "",
      editor: null,
      rootPath: "/v",
      today: "2026-08-24",
    });
    expect(appendTaskLine).toHaveBeenCalledWith(
      "/v/Inbox.md",
      expect.any(String),
    );
  });
});

describe("captureTask — 수집함이 더티 활성 탭일 때", () => {
  beforeEach(() => {
    vi.mocked(resolveTaskWriteTarget).mockReturnValue({
      kind: "document",
      tabId: "t1",
    });
    useEditorStore.setState({
      activeTabId: "t1",
      tabs: [
        {
          contextId: "c",
          filePath: "/v/Inbox.md",
          id: "t1",
          isDirty: true,
          isPinned: false,
          title: "Inbox",
        },
      ],
    });
    vi.mocked(prosemirrorToMarkdown).mockReturnValue("- [ ] 먼저\n");
  });

  it("디스크를 건드리지 않고 열린 문서 끝에 붙인다", async () => {
    const editor = { state: { doc: {} } } as never;
    await captureTask({
      body: "나중",
      captureFile: "Inbox.md",
      editor,
      rootPath: "/v",
      today: "2026-08-24",
    });
    expect(appendTaskLine).not.toHaveBeenCalled();
    expect(useFileStore.getState().openFiles.get("/v/Inbox.md")).toBe(
      "- [ ] 먼저\n- [ ] 나중 ➕2026-08-24\n",
    );
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
  });

  it("끝 개행이 없어도 마지막 줄에 이어붙이지 않는다", async () => {
    vi.mocked(prosemirrorToMarkdown).mockReturnValue("- [ ] 먼저");
    const editor = { state: { doc: {} } } as never;
    await captureTask({
      body: "나중",
      captureFile: "Inbox.md",
      editor,
      rootPath: "/v",
      today: "2026-08-24",
    });
    expect(useFileStore.getState().openFiles.get("/v/Inbox.md")).toBe(
      "- [ ] 먼저\n- [ ] 나중 ➕2026-08-24\n",
    );
  });
});
