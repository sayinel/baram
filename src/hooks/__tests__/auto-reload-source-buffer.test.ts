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
import { beforeEach, describe, expect, it, vi } from "vitest";

const readFile = vi.fn(async (_path: string) => "");

// 디스크 읽기 하나만 갈아끼운다 — 나머지 IPC(설정 저장 등)는 진짜 모듈이 필요하다.
vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  readFile: (path: string) => readFile(path),
}));

import type { EditorTab } from "../../stores/editor/editor";

import { useEditorStore } from "../../stores/editor/editor";
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

beforeEach(() => {
  buffers.clear();
  readFile.mockClear();
  readFile.mockResolvedValue(FRESH);
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
  it("refreshes the buffer of a markdown tab that is in source mode", async () => {
    buffers.set("a", "- [ ] alpha (stale)\n");
    useEditorStore.setState({
      sourceModeTabs: ["a"],
      tabs: [tab("a", "/v/a.md")],
    });

    await triggerAutoReload("/v/a.md", 123);

    expect(buffers.get("a")).toBe(FRESH);
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
    buffers.set("b", "keep b");
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
