import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../ipc/invoke", () => ({
  readFile: (p: string) => readFileMock(p),
  writeFile: (p: string, c: string) => writeFileMock(p, c),
}));
// ‼️ `apply-task-write`는 **목하지 않는다.** 이 파일의 어떤 테스트도 라우터를 목하지
// 않는 것이 계약이다: 세 갈래의 판정(특히 소스 vs 문서의 순서)이 검증 대상이고, 목을
// 끼우면 그 테스트는 "목이 돌려준 값을 따랐다"만 확인하게 된다. 픽스처로 스토어 상태를
// 세우면 진짜 라우터가 원하는 갈래를 그대로 내준다.
//
// `markSourceTabDirty`도 같은 이유로 진짜다 — 그 탭이 실제로 dirty가 되는지를
// **결과로** 볼 수 있다. 목하면 "불렀다"만 남는다.
vi.mock("../../utils/editor/serialize-live-doc", () => ({
  serializeLiveDoc: (e: unknown) => serializeLiveDocMock(e),
}));

import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { appendCaptureToNotes, CaptureAppendError } from "../capture-append";

const readFileMock = vi.fn<(p: string) => Promise<string>>();
const serializeLiveDocMock = vi.fn<(e: unknown) => string>();
const writeFileMock = vi.fn<(p: string, c: string) => Promise<void>>();

const NOTE =
  "# 영감노트\n\n서문.\n\n## Captures\n\n### 2026-09-01 09:00 ^m2609010900\n\n먼저.\n";
const NOW = new Date(2026, 8, 2, 14, 15);
const PATH = "/v/Zettel/notes/n.md";
const TARGET = { matchedTag: "영감노트", path: PATH, title: "영감노트" };
const T1 = { matchedTag: "가", path: "/v/Zettel/notes/a.md", title: "가노트" };
const T2 = { matchedTag: "나", path: "/v/Zettel/notes/b.md", title: "나노트" };
/** `serializeLiveDoc`이 목이라 이 값은 형태만 갖추면 된다 — 내용은 읽히지 않는다. */
const EDITOR = { state: { doc: {} } } as never;

function openTab(opts: {
  active?: boolean;
  id: string;
  isDirty: boolean;
  path?: string;
  source?: boolean;
}) {
  const { active = false, id, isDirty, path = PATH, source = false } = opts;
  useEditorStore.setState({
    activeTabId: active ? id : "tab-other",
    sourceModeTabs: source ? [id] : [],
    tabs: [
      {
        contextId: "c",
        filePath: path,
        id,
        isDirty,
        isPinned: false,
        title: "영감노트",
      },
    ],
  });
}

/** 소스 버퍼 접근자를 등록하고 그 버퍼를 읽는 창을 돌려준다. */
function registerBuffer(tabId: string, initial: string) {
  let buffer = initial;
  useEditorStore.setState({
    sourceBufferAccess: {
      getSourceBuffer: (id) => (id === tabId ? buffer : ""),
      setSourceBuffer: (id, next) => {
        if (id === tabId) buffer = next;
      },
    },
  });
  return { read: () => buffer };
}

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({
    activeTabId: null,
    contentRefreshKey: 0,
    sourceBufferAccess: null,
    sourceModeTabs: [],
    staleContentTabs: [],
    tabs: [],
  });
  useFileStore.setState({ fileMtimes: new Map(), openFiles: new Map() });
  readFileMock.mockResolvedValue(NOTE);
  writeFileMock.mockResolvedValue(undefined);
  serializeLiveDocMock.mockReturnValue(NOTE);
});

describe("appendCaptureToNotes — disk branch", () => {
  it("writes the appended content to disk when no tab holds the file", async () => {
    await appendCaptureToNotes({
      body: "새 메모",
      editor: null,
      now: NOW,
      targets: [TARGET],
    });

    // 단정은 mock 호출 목록이 아니라 **쓰인 내용**을 본다.
    const written = writeFileMock.mock.calls[0][1];
    expect(written).toContain("### 2026-09-02 14:15 ^m2609021415");
    expect(written).toContain("새 메모");
    expect(written).toContain("먼저."); // 기존 항목 보존
    expect(written.indexOf("새 메모")).toBeLessThan(written.indexOf("먼저."));
  });

  // ‼️ §313 회귀 핀. `requestContentRefresh`는 "우리가 문서를 고쳤다" 경로의 도구라
  // `CONTENT_SYNC_META` 보호가 없고, 자동 저장이 방금 디스크에 쓴 내용 위에 편집기의
  // 직렬화 결과를 덮어쓴다. 아카이브가 실제로 그렇게 깨졌다.
  //
  // 진짜 `syncOpenSurfacesAfterFileRewrite`를 쓰므로 단정이 **상태**다: 그 함수가
  // `openFiles`를 방금 쓴 내용으로 맞췄는가, 그리고 리프레시 카운터는 그대로인가.
  it("syncs open surfaces without requestContentRefresh", async () => {
    await appendCaptureToNotes({
      body: "x",
      editor: null,
      now: NOW,
      targets: [TARGET],
    });

    expect(useFileStore.getState().openFiles.get(PATH)).toBe(
      writeFileMock.mock.calls[0][1],
    );
    expect(useEditorStore.getState().contentRefreshKey).toBe(0);
  });

  // §313 배경 탭은 캐시된 ProseMirror 상태에서 복원된다 — 낡음 표시가 없으면 돌아왔을 때
  // 그 캐시가 방금 붙인 항목을 덮고, 다음 저장이 그 덮은 결과를 파일에 쓴다.
  it("marks a clean background tab stale so its cache cannot revert the capture", async () => {
    openTab({ id: "bg", isDirty: false });

    await appendCaptureToNotes({
      body: "x",
      editor: null,
      now: NOW,
      targets: [TARGET],
    });

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(useEditorStore.getState().staleContentTabs).toContain("bg");
  });

  // ‼️ §324-f 출처 줄. 이 단정이 없으면 `opts.source → entry.source` 배선에 커버리지가
  // 전혀 없어, 그 필드를 지우거나 이름을 바꾸는 리팩터가 모든 캡처에서 출처를 조용히
  // 떨어뜨리고도 초록으로 통과한다. 단정은 호출이 아니라 **쓰인 내용**을 본다.
  it("writes the Source line for a capture that names its provenance", async () => {
    await appendCaptureToNotes({
      body: "새 메모",
      editor: null,
      now: NOW,
      source: "제목 https://example.com",
      targets: [TARGET],
    });

    expect(writeFileMock.mock.calls[0][1]).toContain(
      "Source: [제목](https://example.com)",
    );
  });

  // ‼️ 모든 저장 경로가 하는 일이다(`use-auto-save.ts:115` 등). 빠뜨리면 워처가 우리
  // 쓰기를 **외부 변경**으로 읽어 토스트를 띄우고 실행 취소 스택을 버린다.
  it("seeds the self-write baseline so the watcher does not call it external", async () => {
    await appendCaptureToNotes({
      body: "x",
      editor: null,
      now: NOW,
      targets: [TARGET],
    });

    expect(
      useFileStore.getState().getFileMtime(PATH)?.lastSaveMtime,
    ).toBeGreaterThan(0);
  });
});

// ‼️ 여기에도 라우터 목이 없다. 진짜 라우터가 `document`를 주는 조건이 곧 이 픽스처다:
// 활성 + dirty + editor 있음.
//
// ‼️ 그래서 `markDirty(tabId, true)`(서비스의 문서 갈래)는 **증명 가능한 no-op**이다 —
// `markDirty`에 동등성 관문이 있고(`stores/editor/editor.ts`의 `tab.isDirty === dirty`면
// 그대로 반환) 라우터는 이미 dirty인 탭에만 `document`를 주기 때문이다. 그 줄을 지우는
// 뮤테이션은 **살아남는다. 그것이 정직한 결과다.**
//
// 한때 여기에 `mockReturnValue({kind:"document"})` + clean 탭 픽스처를 두어 그 호출을
// 관측 가능하게 만들었다. 그 대가가 더 컸다: 프로덕션 라우터가 만들 수 없는 상태를
// 테스트하고, 이 파일의 "아무도 라우터를 목하지 않는다"는 계약을 깨뜨린다.
// 커버리지 구멍처럼 보인다고 목을 되살리지 말 것.
describe("appendCaptureToNotes — document branch", () => {
  beforeEach(() => {
    openTab({ active: true, id: "tab-1", isDirty: true });
    // `openFiles`는 사용자의 첫 타이핑 이후 낡은 스냅샷이다 — 라이브 문서와 **다르게**
    // 둔다. 같게 두면 `serializeLiveDoc` 대신 이 캐시를 읽는 구현도 통과한다.
    useFileStore.getState().setFileContent(PATH, NOTE);
    serializeLiveDocMock.mockReturnValue(
      `${NOTE}\n사용자가 입력 중이던 문장.\n`,
    );
  });

  it("changes what the editor sees and does not touch disk", async () => {
    await appendCaptureToNotes({
      body: "새 메모",
      editor: EDITOR,
      now: NOW,
      targets: [TARGET],
    });

    expect(writeFileMock).not.toHaveBeenCalled();
    const next = useFileStore.getState().openFiles.get(PATH) ?? "";
    expect(next).toContain("새 메모");
    // ‼️ 사용자가 입력 중이던 내용이 남아 있는 것 — `openFiles`를 읽는 구현은
    // 첫 타이핑 이후 영구히 낡으므로 이 문장을 잃는다(M2-a Critical 1).
    expect(next).toContain("사용자가 입력 중이던 문장.");
    // `tabs[0].isDirty`는 단정하지 않는다. 픽스처가 이미 `true`이므로 그 단정은
    // 구현이 무엇을 하든 통과한다 — 위 describe 주석의 no-op 논증 참조.
  });

  it("requests a content refresh so the appended entry appears on screen", async () => {
    await appendCaptureToNotes({
      body: "새 메모",
      editor: EDITOR,
      now: NOW,
      targets: [TARGET],
    });

    expect(useEditorStore.getState().contentRefreshKey).toBe(1);
  });
});

describe("appendCaptureToNotes — source branch", () => {
  // ‼️ 이 픽스처는 `isDirty === false`인 소스 모드 탭이다. 마크다운 소스 타이핑은
  // 일부러 dirty를 세우지 않으므로(`tab-surface-renderers.tsx:108`), `isDirty`만 보는
  // 구현은 여기서 디스크로 새고 **반드시 실패한다**.
  it("writes into the CodeMirror buffer for a clean source-mode tab", async () => {
    openTab({ active: true, id: "tab-1", isDirty: false, source: true });
    const buffer = registerBuffer(
      "tab-1",
      `${NOTE}사용자가 소스 모드에서 친 줄.\n`,
    );

    await appendCaptureToNotes({
      body: "새 메모",
      editor: null,
      now: NOW,
      targets: [TARGET],
    });

    expect(writeFileMock).not.toHaveBeenCalled();
    expect(buffer.read()).toContain("새 메모");
    expect(buffer.read()).toContain("사용자가 소스 모드에서 친 줄.");
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
  });

  // ‼️ 판정 순서의 핀. 소스 모드이면서 활성·dirty인 탭은 `document` 조건을 **전부**
  // 만족하는 부분집합이다 — 순서가 뒤집힌 구현은 그 탭을 document로 보내고 다음
  // 저장이 버퍼로 파일을 덮어써 캡처를 지운다.
  //
  // ‼️ 이 테스트는 **진짜 라우터**를 쓴다. 목을 끼우면 단정하는 대상(순서)이 사라진다.
  it("prefers the source branch for a tab that is source AND active AND dirty", async () => {
    openTab({ active: true, id: "tab-1", isDirty: true, source: true });
    const buffer = registerBuffer("tab-1", NOTE);

    await appendCaptureToNotes({
      body: "새 메모",
      editor: EDITOR,
      now: NOW,
      targets: [TARGET],
    });

    expect(buffer.read()).toContain("새 메모");
    // 문서 갈래도 디스크 갈래도 `openFiles`를 건드린다 — 비어 있다는 것이 둘 다 돌지
    // 않았다는 증거다.
    expect(useFileStore.getState().openFiles.has(PATH)).toBe(false);
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("falls back to disk when the source buffer accessor is not registered", async () => {
    openTab({ active: true, id: "tab-1", isDirty: false, source: true });
    useEditorStore.setState({ sourceBufferAccess: null });

    await appendCaptureToNotes({
      body: "x",
      editor: EDITOR,
      now: NOW,
      targets: [TARGET],
    });

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(writeFileMock.mock.calls[0][1]).toContain(
      "### 2026-09-02 14:15 ^m2609021415",
    );
  });
});

describe("appendCaptureToNotes — rejection", () => {
  // §322: 캡처가 잃는 것은 다시 누르면 되는 토글이 아니라 다른 어디에도 없는
  // 사용자의 문장이다. 보이지 않는 곳에 쓰고 성공을 보고하느니 시끄럽게 실패한다.
  it("throws and writes nowhere when an unsaved BACKGROUND tab holds the note", async () => {
    openTab({ id: "note", isDirty: true });
    // 소스 모드 탭이 아니므로 이 버퍼는 손대지 말아야 한다.
    const buffer = registerBuffer("note", NOTE);

    const p = appendCaptureToNotes({
      body: "x",
      editor: EDITOR,
      now: NOW,
      targets: [TARGET],
    });
    await expect(p).rejects.toBeInstanceOf(CaptureAppendError);
    await expect(p).rejects.toMatchObject({
      // ‼️ 첫 대상에서 막히면 `appended`는 **빈 배열**이지 `undefined`가 아니다.
      // 호출부가 `err.appended.length > 0`으로 분기하므로 undefined면 거기서 터진다.
      appended: [],
      code: "dirtyTab",
      title: "영감노트",
    });

    expect(writeFileMock).not.toHaveBeenCalled();
    expect(useFileStore.getState().openFiles.size).toBe(0);
    expect(buffer.read()).toBe(NOTE);
  });

  // ‼️ 더티 탭 관문은 **어떤 쓰기보다도 먼저** 모든 대상에 대해 돈다.
  //
  // 예전에는 대상마다 쓰기 직전에 돌았고, 그래서 둘째가 막히면 첫째는 이미 쓰인
  // 뒤였다. 사용자가 그 탭을 저장하고 다시 누르면 첫째에 **중복**이 생긴다 — 블록
  // ID는 문서마다 다시 계산되므로 두 번째 항목을 막아 줄 것이 없다. 관문은 I/O 없는
  // 순수한 스토어 읽기라 앞당기는 데 드는 비용이 없고, 그러면 되돌릴 부분 상태가
  // 애초에 생기지 않는다.
  it("writes nothing at all when a LATER target has an unsaved tab", async () => {
    openTab({ id: "blocked", isDirty: true, path: T2.path });

    const err: unknown = await appendCaptureToNotes({
      body: "x",
      editor: EDITOR,
      now: NOW,
      targets: [T1, T2],
    }).catch((e: unknown) => e);

    // 막히지 않은 첫째까지 **한 글자도** 쓰이지 않았다.
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(useFileStore.getState().openFiles.size).toBe(0);
    // 그리고 오류는 여전히 어느 노트가 막았는지 말한다.
    expect(err).toMatchObject({
      appended: [],
      code: "dirtyTab",
      title: T2.title,
    });
  });

  // ‼️ 같은 회계가 **쓰기 실패**에도 성립해야 한다. 관문만 `CaptureAppendError`를 던지면
  // 디스크 가득 참·권한·IPC 오류는 맨 `Error`로 빠져나가고 `appended`가 사라진다 —
  // 호출자는 "아무것도 저장되지 않았다"고 말하고, 사용자는 다시 눌러 **이미 쓰인 첫째
  // 노트에 중복을 만든다.** `appended`가 막으려는 것이 정확히 그 중복이다.
  it("still reports the landed target when a later write fails", async () => {
    writeFileMock.mockImplementation((p: string) =>
      p === T2.path
        ? Promise.reject(new Error("disk full"))
        : Promise.resolve(undefined),
    );

    const err: unknown = await appendCaptureToNotes({
      body: "x",
      editor: null,
      now: NOW,
      targets: [T1, T2],
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CaptureAppendError);
    expect(err).toMatchObject({
      appended: [{ path: T1.path, title: T1.title }],
      code: "writeFailed",
      title: T2.title,
    });
    // 원인을 잃지 않는 것 — 문구가 "왜"를 말하지 못하면 진단이 불가능해진다.
    expect((err as Error).message).toContain("disk full");
  });
});

describe("appendCaptureToNotes — multiple targets", () => {
  it("appends to every target and returns them all", async () => {
    const out = await appendCaptureToNotes({
      body: "x",
      editor: null,
      now: NOW,
      targets: [T1, T2],
    });

    expect(writeFileMock).toHaveBeenCalledTimes(2);
    expect(out).toEqual([
      { path: T1.path, title: T1.title },
      { path: T2.path, title: T2.title },
    ]);
  });

  // ‼️ 문서마다 블록 ID를 **그 문서 기준으로** 다시 계산하는 것. 문서가 다르면 같은
  // 블록 ID가 있어도 무해하지만(참조가 문서를 함께 지목한다), 한 문서 안에 이미 그
  // 스탬프가 있으면 그 문서에서만 늘어나야 한다.
  it("computes the block id per target document", async () => {
    readFileMock.mockImplementation((p: string) =>
      Promise.resolve(
        p === T1.path ? "## Captures\n\n### x ^m2609021415\n" : NOTE,
      ),
    );

    await appendCaptureToNotes({
      body: "x",
      editor: null,
      now: NOW,
      targets: [T1, T2],
    });

    const [w1, w2] = writeFileMock.mock.calls.map((c) => c[1]);
    expect(w1).toMatch(/\^m2609021415\d{2}\b/); // 충돌 → 늘어남
    expect(w2).toContain("^m2609021415"); // 충돌 없음 → 그대로
  });
});
