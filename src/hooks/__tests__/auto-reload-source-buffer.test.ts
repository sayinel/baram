// §312 외부 변경 자동 리로드는 **소스 버퍼도** 갱신해야 한다.
//
// ‼️ 이 테스트가 지키는 것은 기능이 아니라 데이터 손실이다. `triggerAutoReload`는
// openFiles와 contentRefreshKey만 갱신했다 — 그 둘은 ProseMirror 표면을 다시 채우는
// 통로다. 소스 모드 탭(과 모든 코드 탭)의 저장 경로는 openFiles가 아니라 소스 버퍼를
// 읽으므로(use-file-operations.ts의 handleSave), 버퍼를 그대로 두면 리로드 직후의
// Cmd+S가 **낡은 버퍼로 디스크의 변경을 덮는다.**
//
// 갱신 조건이 `handleSave`의 읽기 조건과 같은 것이 요점이다: 저장이 버퍼를 읽는
// 탭에서만 버퍼를 갱신한다. 두 조건이 갈라지면 한쪽이 반드시 낡는다.
//
// ‼️ 그리고 그 갱신은 **버퍼가 아직 디스크와 같을 때만** 정당하다. 마크다운 소스 모드의
// 타이핑은 탭을 dirty로 만들지 않으므로(tab-surface-renderers.tsx의 주석) 워처의
// "clean일 때만 리로드" 관문이 그 텍스트를 지켜 주지 못한다. 갈라진 버퍼를 조용히 덮으면
// 사용자가 방금 친 글자가 버퍼에서도 화면에서도 사라진다 — 충돌 모달조차 뜨지 않는다.
// 그래서 "갈라졌는가"는 `useFileStore`가 캐시한 그 파일의 내용과 비교해 판정한다.
import { beforeEach, describe, expect, it, vi } from "vitest";

const readFile = vi.fn(async (_path: string) => "");

// 디스크 읽기 하나만 갈아끼운다 — 나머지 IPC(설정 저장 등)는 진짜 모듈이 필요하다.
vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  readFile: (path: string) => readFile(path),
}));

import type { EditorTab } from "../../stores/editor/editor";

import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { triggerAutoReload } from "../use-file-operations";

const FRESH = "- [x] alpha (from disk)\n";

const buffers = new Map<string, string>();

const tab = (id: string, filePath: string): EditorTab => ({
  contextId: "c",
  filePath,
  id,
  isDirty: false,
  isPinned: false,
  title: id,
});

/** 리로드 **전에** 디스크에 있던 내용 — "버퍼가 갈라졌는가"의 기준선이다. */
const cacheOnDisk = (path: string, content: string) => {
  useFileStore.getState().setFileContent(path, content);
};

beforeEach(() => {
  buffers.clear();
  readFile.mockClear();
  readFile.mockResolvedValue(FRESH);
  useFileStore.setState({ openFiles: new Map() });
  useEditorStore.setState({
    activeTabId: null,
    mruOrder: [],
    sourceBufferAccess: {
      getSourceBuffer: (id) => buffers.get(id) ?? "",
      setSourceBuffer: (id, content) => {
        buffers.set(id, content);
      },
    },
    sourceModeTabs: [],
    tabs: [],
  });
});

describe("triggerAutoReload — source buffer", () => {
  it("refreshes an undiverged source-mode buffer — it still matched the old disk text", async () => {
    // C2: 사용자가 소스 모드에서 아무것도 치지 않았다. 버퍼는 디스크의 옛 내용 그대로라
    // 잃을 것이 없고, 갱신하지 않으면 다음 Cmd+S가 그 옛 내용으로 디스크를 되돌린다.
    buffers.set("a", "- [ ] alpha (stale)\n");
    cacheOnDisk("/v/a.md", "- [ ] alpha (stale)\n");
    useEditorStore.setState({
      sourceModeTabs: ["a"],
      tabs: [tab("a", "/v/a.md")],
    });

    await triggerAutoReload("/v/a.md", 123);

    expect(buffers.get("a")).toBe(FRESH);
  });

  it("does not destroy unsaved typing in a source-mode buffer", async () => {
    // ‼️ 이 탭은 dirty가 **아니다**. 마크다운 소스 모드의 타이핑은 dirty를 켜지 않으므로
    // (tab-surface-renderers.tsx:108) 워처의 clean 관문이 여기까지 흘려보낸다. 앱 안에서만
    // 재현된다: Cmd+/ → 타이핑 → 같은 파일의 아젠다 체크박스 클릭 → 디스크 쓰기 → 워처.
    //
    // 단정은 "덮어쓰지 않았다"가 아니라 **사용자가 친 글자가 남아 있다**이다 — 저장 경로와
    // 화면(§312 동기화 effect)이 둘 다 이 버퍼를 읽으므로, 여기서 사라지면 양쪽에서 사라진다.
    cacheOnDisk("/v/a.md", "- [ ] alpha\n");
    buffers.set("a", "- [ ] alpha\n\n사용자가 방금 친 문단\n");
    useEditorStore.setState({
      sourceModeTabs: ["a"],
      tabs: [tab("a", "/v/a.md")],
    });

    await triggerAutoReload("/v/a.md", 123);

    expect(buffers.get("a")).toContain("사용자가 방금 친 문단");
    expect(buffers.get("a")).toBe("- [ ] alpha\n\n사용자가 방금 친 문단\n");
  });

  it("does not destroy unsaved typing in a code tab either", async () => {
    // 코드 탭은 타이핑이 dirty를 켜므로 워처가 먼저 막아 주지만, 그 관문 하나에만 기대면
    // 그것이 바뀌는 날 같은 손실이 돌아온다. 갈라짐 판정은 두 갈래 모두에 걸린다.
    cacheOnDisk("/v/x.ts", "export const a = 1;\n");
    buffers.set("t", "export const a = 2; // 방금 친 것\n");
    useEditorStore.setState({
      sourceModeTabs: [],
      tabs: [tab("t", "/v/x.ts")],
    });

    await triggerAutoReload("/v/x.ts", 123);

    expect(buffers.get("t")).toBe("export const a = 2; // 방금 친 것\n");
  });

  it("leaves a WYSIWYG markdown tab's buffer alone", async () => {
    // 이 탭의 저장 경로는 ProseMirror 문서를 읽는다. 버퍼는 마지막으로 소스 모드였을
    // 때의 잔여물이고, 여기에 쓰면 다음 Cmd+/ 가 엉뚱한 텍스트를 보여준다.
    buffers.set("a", "- [ ] alpha (last source visit)\n");
    useEditorStore.setState({
      sourceModeTabs: [],
      tabs: [tab("a", "/v/a.md")],
    });

    await triggerAutoReload("/v/a.md", 123);

    expect(buffers.get("a")).toBe("- [ ] alpha (last source visit)\n");
  });

  it("refreshes a code tab even though it is never in sourceModeTabs", async () => {
    // 비마크다운 탭은 **항상** 코드 표면이다 — 토글 집합에 들어가지 않는다.
    // handleSave의 `isCode` 갈래가 그래서 집합을 묻지 않고 버퍼를 읽는다.
    buffers.set("t", "export const stale = 1;\n");
    cacheOnDisk("/v/x.ts", "export const stale = 1;\n");
    useEditorStore.setState({
      sourceModeTabs: [],
      tabs: [tab("t", "/v/x.ts")],
    });

    await triggerAutoReload("/v/x.ts", 123);

    expect(buffers.get("t")).toBe(FRESH);
  });

  it("does not blank a binary viewer's buffer", async () => {
    // PDF는 "" 센티널로 캐시된다. 그 값을 버퍼에 쓰면 다른 탭의 텍스트를 지우는 것과
    // 같은 종류의 사고가 된다.
    buffers.set("p", "not a pdf's text");
    useEditorStore.setState({
      sourceModeTabs: [],
      tabs: [tab("p", "/v/doc.pdf")],
    });

    await triggerAutoReload("/v/doc.pdf", 123);

    expect(buffers.get("p")).toBe("not a pdf's text");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("touches only the tabs that show the reloaded file", async () => {
    buffers.set("a", "stale a");
    cacheOnDisk("/v/a.md", "stale a");
    buffers.set("b", "keep b");
    cacheOnDisk("/v/b.md", "keep b");
    useEditorStore.setState({
      sourceModeTabs: ["a", "b"],
      tabs: [tab("a", "/v/a.md"), tab("b", "/v/b.md")],
    });

    await triggerAutoReload("/v/a.md", 123);

    expect(buffers.get("a")).toBe(FRESH);
    expect(buffers.get("b")).toBe("keep b");
  });

  it("is a no-op when no source surface is mounted", async () => {
    // 접근자가 없으면 버퍼를 쥔 훅 자체가 없다 — 나중에 디스크를 덮을 버퍼도 없다.
    useEditorStore.setState({
      sourceBufferAccess: null,
      sourceModeTabs: ["a"],
      tabs: [tab("a", "/v/a.md")],
    });

    await expect(triggerAutoReload("/v/a.md", 123)).resolves.toBeUndefined();
    expect(buffers.size).toBe(0);
  });
});
