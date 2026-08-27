import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../ipc/invoke", () => ({ appendTaskLine: vi.fn() }));
// ‼️ `resolveTaskWriteTarget`만 목한다. `markSourceTabDirty`는 진짜여야 그 탭이 실제로
// dirty가 되는지를 **결과로** 볼 수 있다 — 목하면 "불렀다"만 남고, 저장하지 않고 닫는
// 사용자가 확인을 받는지는 아무도 확인하지 않게 된다.
vi.mock("../../utils/tasks/apply-task-write", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../utils/tasks/apply-task-write")
  >()),
  resolveTaskWriteTarget: vi.fn(),
}));
vi.mock("../../pipeline", () => ({ prosemirrorToMarkdown: vi.fn() }));

import { appendTaskLine } from "../../ipc/invoke";
import { prosemirrorToMarkdown } from "../../pipeline";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { resolveTaskWriteTarget } from "../../utils/tasks/apply-task-write";
import { buildCaptureLine, CaptureError, captureTask } from "../task-capture";

/** 코드까지 확인한다 — UI가 원인별 문구를 고르는 근거가 그 코드다. */
async function rejectsWithCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toBeInstanceOf(CaptureError);
  await p.catch((err: unknown) => {
    expect((err as CaptureError).code).toBe(code);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({
    activeTabId: null,
    sourceBufferAccess: null,
    sourceModeTabs: [],
    tabs: [],
  });
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

  it("볼트 안의 하위 디렉터리 경로도 그대로 쓴다", async () => {
    vi.mocked(appendTaskLine).mockResolvedValue("x");
    await captureTask({
      body: "a",
      captureFile: "inbox/In.md",
      editor: null,
      rootPath: "/v",
      today: "2026-08-24",
    });
    expect(appendTaskLine).toHaveBeenCalledWith(
      "/v/inbox/In.md",
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
      contentRefreshKey: 0,
      // ‼️ `isDirty: false`로 시작하는 것이 이 픽스처의 요점이다. 라우팅은 목한
      // `resolveTaskWriteTarget`이 정하므로 이 값은 라우팅에 영향을 주지 않고,
      // 아래 단언이 `markDirty` 호출 **자체**를 검증하게 된다 — `true`로 시작하면
      // `markDirty`를 지워도 그 단언이 통과한다(리뷰 Minor 3).
      tabs: [
        {
          contextId: "c",
          filePath: "/v/Inbox.md",
          id: "t1",
          isDirty: false,
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
  });

  it("탭을 더티로 표시한다 — 이게 없으면 붙인 줄이 저장되지 않는다", async () => {
    const editor = { state: { doc: {} } } as never;
    await captureTask({
      body: "나중",
      captureFile: "Inbox.md",
      editor,
      rootPath: "/v",
      today: "2026-08-24",
    });
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
  });

  it("내용 리프레시를 요청한다 — 이게 없으면 붙인 줄이 화면에 안 보인다", async () => {
    const editor = { state: { doc: {} } } as never;
    await captureTask({
      body: "나중",
      captureFile: "Inbox.md",
      editor,
      rootPath: "/v",
      today: "2026-08-24",
    });
    expect(useEditorStore.getState().contentRefreshKey).toBe(1);
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

// §312 리뷰 Major 3 — `resolveTaskWriteTarget`은 "활성 + 더티"가 아닌 모든 탭을
// 디스크로 보낸다. 배경 더티 탭도 그렇고, 그 탭으로 돌아오면 캐시된 EditorState가
// 복원돼 append된 줄이 사라진다. 잃는 것이 체크 토글이 아니라 사용자의 문장이므로
// 쓰지 않고 실패한다.
describe("captureTask — 수집함이 저장하지 않은 배경 탭일 때", () => {
  function openTab(isDirty: boolean) {
    useEditorStore.setState({
      activeTabId: "other",
      tabs: [
        {
          contextId: "c",
          filePath: "/v/Inbox.md",
          id: "inbox",
          isDirty,
          isPinned: false,
          title: "Inbox",
        },
      ],
    });
  }

  it("디스크에 쓰지 않고 dirtyTab으로 거절한다", async () => {
    openTab(true);
    await rejectsWithCode(
      captureTask({
        body: "은행 연락",
        captureFile: "Inbox.md",
        editor: null,
        rootPath: "/v",
        today: "2026-08-24",
      }),
      "dirtyTab",
    );
    expect(appendTaskLine).not.toHaveBeenCalled();
  });

  it("그 탭이 깨끗하면 평소대로 append한다", async () => {
    openTab(false);
    vi.mocked(appendTaskLine).mockResolvedValue("x");
    await captureTask({
      body: "은행 연락",
      captureFile: "Inbox.md",
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

// §312 소스 모드 탭은 dirty·활성과 무관하게 `source` 판정을 받는다. 그 탭에서 권위 있는
// 텍스트는 CodeMirror 버퍼이고 저장도 그 버퍼를 쓰므로(`handleSave`,
// use-file-operations.ts:231-232), 그 밖의 어디에 붙여도 다음 저장이 지운다:
// 라이브 문서에 붙이면 저장이 버퍼로 덮어쓰고, **디스크에 붙여도 같다.**
//
// ‼️ 디스크 경로가 특히 함정이었다. `assertNoUnsavedTab`은 `tab.isDirty`로 판정하는데,
// 마크다운 소스 모드 타이핑은 일부러 dirty를 세우지 않는다(`tab-surface-renderers.tsx:108`).
// 즉 저장하지 않은 글을 들고 있는 소스 탭이 **clean으로 보이고**, 관문을 통과하고, 디스크에
// 붙은 캡처가 다음 저장에 지워졌다. 잃는 것이 다시 누르면 되는 체크 토글이 아니라 다른
// 어디에도 없는 사용자의 문장이다.
describe("captureTask — 수집함이 소스 모드 탭일 때", () => {
  function openSourceTab(isDirty: boolean, initial = "- [ ] 먼저\n") {
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
          filePath: "/v/Inbox.md",
          id: "t1",
          isDirty,
          isPinned: false,
          title: "Inbox",
        },
      ],
    });
    return { read: () => buffer };
  }

  function capture(editor: unknown = { state: { doc: {} } }) {
    return captureTask({
      body: "은행 연락",
      captureFile: "Inbox.md",
      editor: editor as never,
      rootPath: "/v",
      today: "2026-08-24",
    });
  }

  const LINE = "- [ ] 은행 연락 ➕2026-08-24";

  beforeEach(() => {
    vi.mocked(resolveTaskWriteTarget).mockReturnValue({
      kind: "source",
      tabId: "t1",
    });
    vi.mocked(prosemirrorToMarkdown).mockReturnValue("- [ ] 먼저\n");
  });

  it("보이는 버퍼에 붙인다 — 라이브 문서에도 디스크에도 붙이지 않는다", async () => {
    const buffer = openSourceTab(false);

    const raw = await capture();

    expect(buffer.read()).toBe(`- [ ] 먼저\n${LINE}\n`);
    expect(raw).toBe(LINE);
    expect(appendTaskLine).not.toHaveBeenCalled();
    // `openFiles`/`requestContentRefresh`는 ProseMirror 표면을 다시 채우는 통로인데
    // 지금 보이는 것은 그 표면이 아니다(`writeToSourceBuffer`와 같은 이유).
    expect(useFileStore.getState().openFiles.size).toBe(0);
  });

  // ‼️ 이것이 정확히 잃던 문장이다. 버퍼에 저장하지 않은 글이 있는데도 탭은 clean이다.
  // 디스크로 붙이면 이 두 줄은 다음 저장에서 통째로 되돌아가고 캡처만 사라진다.
  it("clean으로 보이는 탭이 저장하지 않은 글을 들고 있어도 그 글과 캡처가 함께 남는다", async () => {
    const buffer = openSourceTab(
      false,
      "- [ ] 먼저\n아직 저장하지 않은 문장\n",
    );

    await capture();

    // 저장(`handleSave`)이 파일에 쓰는 것이 바로 이 문자열이다.
    expect(buffer.read()).toBe(
      `- [ ] 먼저\n아직 저장하지 않은 문장\n${LINE}\n`,
    );
    expect(appendTaskLine).not.toHaveBeenCalled();
  });

  // 표시가 없으면 버퍼에만 있는 이 줄은 사용자에게 흔적을 남기지 않는다 — 저장하지 않고
  // 닫아도 확인을 받지 못하고, 외부 변경이 오면 충돌 모달 대신 조용한 자동 리로드로 간다.
  it("그 탭을 dirty로 세운다", async () => {
    openSourceTab(false);

    await capture();

    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
  });

  it("이미 dirty인 탭도 같은 버퍼에 붙는다 — 더 이상 거절하지 않는다", async () => {
    const buffer = openSourceTab(true);

    await capture();

    expect(buffer.read()).toBe(`- [ ] 먼저\n${LINE}\n`);
    expect(appendTaskLine).not.toHaveBeenCalled();
  });

  it("끝 개행이 없는 버퍼에는 줄바꿈을 먼저 넣는다 — 앞 줄에 이어 붙지 않는다", async () => {
    const buffer = openSourceTab(false, "- [ ] 먼저");

    await capture();

    expect(buffer.read()).toBe(`- [ ] 먼저\n${LINE}\n`);
  });

  it("빈 버퍼에는 빈 줄을 만들지 않는다", async () => {
    const buffer = openSourceTab(false, "");

    await capture();

    expect(buffer.read()).toBe(`${LINE}\n`);
  });

  // 접근자 미등록은 경합이 아니라 "쓸 버퍼가 존재하지 않는다"다 — 버퍼를 소유한
  // `useSourceMode`(App 수명)가 마운트돼 있지 않다는 뜻이고, 그러면 나중에 디스크를
  // 덮어쓸 버퍼도 없다. 정리 조작 셋과 같은 폴백이다(`applyTaskWrite`).
  it("소스 버퍼 접근자가 없으면 디스크로 폴백한다", async () => {
    openSourceTab(false);
    useEditorStore.setState({ sourceBufferAccess: null });
    vi.mocked(appendTaskLine).mockResolvedValue(LINE);

    await capture();

    expect(appendTaskLine).toHaveBeenCalledWith("/v/Inbox.md", LINE);
  });

  it("접근자도 없고 탭이 dirty면 어디에도 붙이지 않는다", async () => {
    openSourceTab(true);
    useEditorStore.setState({ sourceBufferAccess: null });

    await rejectsWithCode(capture(), "dirtyTab");

    expect(appendTaskLine).not.toHaveBeenCalled();
    expect(useFileStore.getState().openFiles.size).toBe(0);
  });
});

// §312 리뷰 Major 5 — 아래 값들은 append 자체는 성공하지만 그 태스크가 어느
// 버킷에도 영영 나타나지 않는다. `get_vault_tasks`는 볼트만 걷고, 워처는 감시
// 루트 아래 마크다운 이벤트만 듣기 때문이다.
describe("captureTask — 인덱싱될 수 없는 수집함 경로", () => {
  async function capture(captureFile: string) {
    return captureTask({
      body: "a",
      captureFile,
      editor: null,
      rootPath: "/v",
      today: "2026-08-24",
    });
  }

  it("볼트 밖 절대 경로를 거절한다", async () => {
    await rejectsWithCode(capture("/elsewhere/In.md"), "outsideVault");
    expect(appendTaskLine).not.toHaveBeenCalled();
  });

  it("`..`로 볼트를 벗어나는 값을 거절한다", async () => {
    await rejectsWithCode(capture("../In.md"), "outsideVault");
    expect(appendTaskLine).not.toHaveBeenCalled();
  });

  it("볼트 루트 자신을 거절한다", async () => {
    await rejectsWithCode(capture("/v"), "outsideVault");
  });

  it("마크다운이 아닌 이름을 거절한다", async () => {
    await rejectsWithCode(capture("Inbox.txt"), "notMarkdown");
    await rejectsWithCode(capture("Inbox"), "notMarkdown");
    expect(appendTaskLine).not.toHaveBeenCalled();
  });

  // 인덱싱하는 두 곳은 `ends_with(".md")`로 대소문자를 구분한다
  // (`use-task-watcher.ts:51-53`, `fs/mod.rs:88`). 여기서만 관대해지면 줄은 파일에
  // 적히는데 스캔도 워처도 그 파일을 걷지 않아, 태스크가 어느 버킷에도 영영
  // 나타나지 않는다 — 이 게이트가 막으려던 실패 모드 그대로다.
  it("대문자 확장자를 거절한다 — 인덱싱 경로가 대소문자를 구분한다", async () => {
    await rejectsWithCode(capture("Inbox.MD"), "notMarkdown");
    await rejectsWithCode(capture("Inbox.Markdown"), "notMarkdown");
    expect(appendTaskLine).not.toHaveBeenCalled();
  });

  it("디렉터리로 적은 값을 거절한다 — 그대로 두면 `notes`라는 이름의 파일이 생긴다", async () => {
    await rejectsWithCode(capture("notes/"), "notMarkdown");
    expect(appendTaskLine).not.toHaveBeenCalled();
  });

  it("`.markdown`은 받는다 — 워처와 전체 스캔이 둘 다 걷는 확장자다", async () => {
    vi.mocked(appendTaskLine).mockResolvedValue("x");
    await capture("Inbox.markdown");
    expect(appendTaskLine).toHaveBeenCalledWith(
      "/v/Inbox.markdown",
      expect.any(String),
    );
  });
});

// §307D — 에디터의 워드 트리거(`task-field-tokens.ts`)를 캡처도 그대로 받는다.
// 같은 표기가 캡처에서만 문자로 남으면 사용자는 언어를 두 개 배우게 된다.
describe("buildCaptureLine — 날짜·우선순위 워드 트리거", () => {
  it("due:m을 내일의 📅로 바꾼다", () => {
    expect(buildCaptureLine("장보기 due:m", "2026-08-24")).toBe(
      "- [ ] 장보기 ➕2026-08-24 📅2026-08-25",
    );
  });

  it("sched:·start:도 각자의 이모지로 바꾼다", () => {
    expect(buildCaptureLine("작업 sched:t start:+2", "2026-08-24")).toBe(
      "- [ ] 작업 ➕2026-08-24 🛫2026-08-26 ⏳2026-08-24",
    );
  });

  it("!N과 prio:N을 우선순위 마커로 바꾼다", () => {
    expect(buildCaptureLine("보고서 !1 due:2026-09-01", "2026-08-24")).toBe(
      "- [ ] 보고서 ➕2026-08-24 📅2026-09-01 🔺",
    );
    expect(buildCaptureLine("메모 prio:5", "2026-08-24")).toBe(
      "- [ ] 메모 ➕2026-08-24 ⏬",
    );
  });

  it("prio:3(보통)은 트리거만 지우고 마커를 남기지 않는다", () => {
    expect(buildCaptureLine("보통 prio:3", "2026-08-24")).toBe(
      "- [ ] 보통 ➕2026-08-24",
    );
  });

  it("해석할 수 없는 값은 그대로 둔다 — 사용자가 친 글자를 지우지 않는다", () => {
    expect(buildCaptureLine("장보기 due:내일", "2026-08-24")).toBe(
      "- [ ] 장보기 due:내일 ➕2026-08-24",
    );
  });

  it("단어 중간의 트리거는 잡지 않는다 — overdue:는 due:가 아니다", () => {
    expect(buildCaptureLine("overdue:8/30 확인", "2026-08-24")).toBe(
      "- [ ] overdue:8/30 확인 ➕2026-08-24",
    );
  });

  it("!123처럼 뒤가 이어지는 표기는 우선순위가 아니다", () => {
    expect(buildCaptureLine("이슈 !123", "2026-08-24")).toBe(
      "- [ ] 이슈 !123 ➕2026-08-24",
    );
  });
});

// §312 리뷰 Major 1 — 다이얼로그의 태그 칸은 `#someday`까지 자동완성해 준다.
// 그 값이 줄에 닿지 않으면 이 슬라이스가 만든 정리 어휘가 캡처 지점에서 끊긴다.
describe("buildCaptureLine — 태그", () => {
  it("태그를 인라인 #토큰으로 접어 넣는다", () => {
    expect(buildCaptureLine("Rust 배우기", "2026-08-24", ["someday"])).toBe(
      "- [ ] Rust 배우기 #someday ➕2026-08-24",
    );
  });

  it("입력의 앞 #과 빈 값을 정리한다", () => {
    expect(buildCaptureLine("정리", "2026-08-24", ["#work", "", " "])).toBe(
      "- [ ] 정리 #work ➕2026-08-24",
    );
  });

  it("중복과 본문에 이미 있는 태그는 두 번 적지 않는다", () => {
    expect(
      buildCaptureLine("공부 #someday", "2026-08-24", ["someday", "someday"]),
    ).toBe("- [ ] 공부 #someday ➕2026-08-24");
  });
});

// §312 리뷰 Minor 1·2 — 둘 다 아무것도 실패하지 않고 조용히 잘못되는 종류다.
describe("buildCaptureLine — 정규화 뒤에야 드러나는 것들", () => {
  it("본문의 맨 ➕를 지운다 — 파서는 첫 ➕만 보고 재시도하지 않는다", () => {
    expect(buildCaptureLine("add ➕ sign", "2026-08-25")).toBe(
      "- [ ] add sign ➕2026-08-25",
    );
  });

  it("정규화 후 본문이 비면 null — 지울 수 없는 빈 행을 만들지 않는다", () => {
    expect(buildCaptureLine("- [ ] ➕2026-01-01", "2026-08-24")).toBeNull();
    expect(buildCaptureLine("due:m", "2026-08-24")).toBeNull();
  });

  it("captureTask는 그 본문을 emptyBody로 거절한다", async () => {
    await rejectsWithCode(
      captureTask({
        body: "➕2026-01-01",
        captureFile: "Inbox.md",
        editor: null,
        rootPath: "/v",
        today: "2026-08-24",
      }),
      "emptyBody",
    );
    expect(appendTaskLine).not.toHaveBeenCalled();
  });
});
