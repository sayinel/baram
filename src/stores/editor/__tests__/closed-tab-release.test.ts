// §3.5 닫힌 탭이 쓰던 원문 · 수정 시각 · dirty 기준 문서를 내려놓는다 (#798).
//
// 항목 수를 센다. 열린 탭이 쓰는 것은 그대로 남아야 하므로 단정마다 남아 있어야 할 것을 짝으로 둔다.
import type { TabSwitchContext } from "../../../hooks/tab-switching/types";
import type { EditorTab } from "../editor";
import type { PDFDocumentProxy } from "pdfjs-dist";

import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetPdfDocumentCacheForTest,
  __setPdfDocumentLoaderForTest,
  acquirePdfDocument,
} from "../../../components/editor/pdf/pdf-doc-cache";
import { saveOutgoingTab } from "../../../hooks/tab-switching/save-outgoing-tab";
import {
  getOriginalDoc,
  markContentLoaded,
  updateOriginalDoc,
} from "../../../utils/editor/programmatic-update";
import { useFileStore } from "../../file/file";
import { startClosedTabRelease } from "../closed-tab-release";
import { useEditorStore } from "../editor";

let stop: () => void = () => undefined;

const schema = new Schema({
  nodes: { doc: { content: "paragraph+" }, paragraph: {}, text: {} },
});

function hasOriginalDoc(tabId: string): boolean {
  return getOriginalDoc(tabId) !== undefined;
}

function held() {
  const { fileMtimes, openFiles } = useFileStore.getState();
  return { mtimes: fileMtimes.size, files: openFiles.size };
}

function tab(id: string, filePath: string, over: Partial<EditorTab> = {}) {
  return {
    contextId: "",
    filePath,
    id,
    isDirty: false,
    isPinned: false,
    title: id,
    type: "file" as const,
    ...over,
  };
}

/** 앱의 열기와 같은 순서로 원문을 넣고 탭을 연다. */
function open(id: string, filePath: string, content = `body of ${id}`) {
  const files = useFileStore.getState();
  files.setFileContent(filePath || id, content);
  files.initFileMtime(filePath || id);
  useEditorStore.getState().openTab(tab(id, filePath));
  updateOriginalDoc(id, schema.node("doc", null, [schema.node("paragraph")]));
}

beforeEach(() => {
  useFileStore.setState({ fileMtimes: new Map(), openFiles: new Map() });
  useEditorStore.setState({
    activeTabId: null,
    mruOrder: [],
    sourceEditedTabs: [],
    sourceModeTabs: [],
    staleContentTabs: [],
    tabs: [],
  });
  stop = startClosedTabRelease();
});

afterEach(() => stop());

// 이것을 실패시키는 것: closed-tab-release.ts 의 구독(`releaseClosedTabs` 호출)을 지우면
// 이 describe 의 release 단정이 모두 깨진다.
describe("§3.5 closing a tab releases what only it used (#798)", () => {
  it("returns to the starting count after opening and closing 100 times", () => {
    const start = held();
    for (let i = 0; i < 100; i++) {
      open(`t${i}`, `/v/n${i}.md`);
      expect(held().files).toBe(start.files + 1);
      useEditorStore.getState().closeTab(`t${i}`);
    }
    expect(held()).toEqual(start);
  });

  it("releases through every close action", () => {
    open("a", "/v/a.md");
    open("b", "/v/b.md");
    open("c", "/v/c.md");
    open("d", "/v/d.md");
    useEditorStore.getState().closeTabsToRight("c");
    expect([...useFileStore.getState().openFiles.keys()]).toEqual([
      "/v/a.md",
      "/v/b.md",
      "/v/c.md",
    ]);
    useEditorStore.getState().closeOtherTabs("b");
    expect([...useFileStore.getState().openFiles.keys()]).toEqual(["/v/b.md"]);
    useEditorStore.getState().closeAllTabs();
    expect(held()).toEqual({ files: 0, mtimes: 0 });

    useEditorStore.getState().openTab(tab("x", "/v/x.md", { contextId: "k" }));
    useFileStore.getState().setFileContent("/v/x.md", "x");
    useEditorStore.getState().closeTabsForContexts(new Set(["k"]));
    expect(held().files).toBe(0);
  });

  it("clears the closed tab's dirty-detection baseline", () => {
    open("a", "/v/a.md");
    open("b", "/v/b.md");
    useEditorStore.getState().closeTab("a");
    expect(hasOriginalDoc("a")).toBe(false);
    expect(hasOriginalDoc("b")).toBe(true);
  });

  it("releases an untitled tab's content by its id", () => {
    open("u1", "");
    expect(useFileStore.getState().openFiles.has("u1")).toBe(true);
    useEditorStore.getState().closeTab("u1");
    expect(useFileStore.getState().openFiles.has("u1")).toBe(false);
  });

  // 이것을 실패시키는 것: `releaseClosedTabs` 의 `stillShown` 거르기를 빼면 남은 탭의 원문이 지워진다.
  it("keeps the content while another tab still shows the same file", () => {
    open("a", "/v/same.md", "shared");
    // openTab 은 같은 경로의 탭을 다시 만들지 않는다. 두 탭이 한 파일을 가리키는 것은 Save As 가
    // 이미 열린 경로에 저장할 때처럼 setState 로 경로를 바꾸는 길이다.
    useEditorStore.setState((s) => ({
      tabs: [...s.tabs, tab("a2", "/v/same.md")],
    }));
    useEditorStore.getState().closeTab("a");
    expect(useFileStore.getState().openFiles.get("/v/same.md")).toBe("shared");
    expect(useFileStore.getState().fileMtimes.has("/v/same.md")).toBe(true);
    useEditorStore.getState().closeTab("a2");
    expect(held()).toEqual({ files: 0, mtimes: 0 });
  });

  it("releases nothing when a pinned tab refuses to close", () => {
    open("p", "/v/p.md");
    useEditorStore.getState().pinTab("p");
    useEditorStore.getState().closeTab("p");
    // 이것을 실패시키는 것: editor.ts 의 `closeTabsById` 에서 `!t.isPinned` 거르기를 빼면 고정된
    // 탭이 목록으로 넘어왔을 때 닫힌다. `closedIds.size === 0` 조기 반환을 지우면 닫을 것이 없어도
    // editor store 의 state 가 새 객체가 된다.
    const before = useEditorStore.getState();
    useEditorStore.getState().closeTabsById(["p"], "p");
    expect(useEditorStore.getState()).toBe(before);
    expect(useEditorStore.getState().tabs.map((t) => t.id)).toEqual(["p"]);
    expect(useFileStore.getState().openFiles.has("/v/p.md")).toBe(true);
    expect(hasOriginalDoc("p")).toBe(true);
  });

  it("does not release a file whose tab is renamed", () => {
    // 같은 탭 id 가 남으므로 아무것도 닫히지 않았다 — 원문의 key 를 옮기는 것은 renameFileEntry 다.
    open("a", "/v/old.md");
    useEditorStore.getState().renameTab("/v/old.md", "/v/new.md", "new.md");
    expect(useFileStore.getState().openFiles.has("/v/old.md")).toBe(true);
  });

  // 이것을 실패시키는 것: file.ts 의 `releaseFileContents` 에서 `held.length === 0` 조기 반환을
  // 지우면 dirty 표시만 바뀌어도 file store 의 state 가 새 객체가 된다.
  it("leaves the file store untouched when tabs change without closing", () => {
    open("a", "/v/a.md");
    const before = useFileStore.getState();
    useEditorStore.getState().markDirty("a", true);
    // 원문이 없는 탭(graph)을 닫아도 file store 는 그대로다.
    useEditorStore.getState().openGraphTab();
    const graph = useEditorStore
      .getState()
      .tabs.find((t) => t.type === "graph");
    useEditorStore.getState().closeTab(graph!.id);
    expect(useFileStore.getState()).toBe(before);
    expect(useFileStore.getState().openFiles.has("/v/a.md")).toBe(true);
  });
});

describe("§3.5 the tab switch after closing the active tab", () => {
  // 활성 탭을 닫으면 tab switching effect 가 그 탭 id 로 saveOutgoingTab 을 부른다. 그 함수가
  // 닫힌 탭의 원문을 다시 써 넣으면 위의 release 가 무의미해진다. 지금은 탭을 store 에서 찾지 못해
  // 아무것도 쓰지 않는다 — 이 release 가 기대는 동작이라 고정한다.
  // 이것을 실패시키는 것: save-outgoing-tab.ts 가 store 에서 사라진 탭 대신 붙잡아 둔 탭 객체를 쓰게
  // 하면(`tabs.find(...) ?? <닫힌 탭>`) 닫힌 탭의 원문이 다시 들어온다.
  it("does not write the closed tab's content back", () => {
    open("a", "/v/a.md");
    useEditorStore.getState().closeTab("a");
    const doc = schema.node("doc", null, [schema.node("paragraph")]);
    const cache = new Map<string, EditorState>();
    const ctx = {
      editor: { state: EditorState.create({ doc, schema }) },
      editorStateCache: { current: cache },
      getSourceBuffer: () => "buffer",
      keepalive: { get: () => undefined },
      sourceModeTabs: new Set<string>(),
    } as unknown as TabSwitchContext;

    saveOutgoingTab(ctx, "a");

    expect(useFileStore.getState().openFiles.has("/v/a.md")).toBe(false);
    expect(cache.size).toBe(0);

    // 긍정 짝 — 편집기가 들고 있는 열린 탭이면 같은 호출이 원문을 쓴다.
    open("b", "/v/b.md", "stale");
    markContentLoaded("b");
    saveOutgoingTab(ctx, "b");
    expect(useFileStore.getState().openFiles.get("/v/b.md")).not.toBe("stale");
  });
});

// §3.5 (#798) 내려놓은 기록에는 뷰어 버전도 있었다. 다시 연 파일이 처음부터 다시 세면, PDF 문서 캐시가 앞
// 탭이 같은 key 로 남긴 문서를 돌려준다 — 닫힌 동안 파일이 바뀌었어도(watcher 는 닫힌 파일을 더 읽지 않는다).
// 이것을 실패시키는 것: closed-tab-release.ts 의 `noteShownFiles` 호출을 지우면 첫째가(다시 연 PDF 가 앞
// 문서를 받는다), `!prevIds.has(t.id)` 를 빼면 rename 시험이, `!shownBefore.has(t.filePath)` 를 빼면 둘째
// 탭 시험이 깨진다.
describe("§3.5 a reopened file's viewer version", () => {
  function version(path: string): number | undefined {
    return useFileStore.getState().fileMtimes.get(path)?.viewerVersion;
  }

  it("gives a reopened PDF a version its earlier tab did not have, so the document cache loads it again", () => {
    const loads: number[] = [];
    __setPdfDocumentLoaderForTest(async (_path, v) => {
      loads.push(v);
      return { destroy: vi.fn() } as unknown as PDFDocumentProxy;
    });
    try {
      open("a", "/v/paper.pdf", "");
      const first = version("/v/paper.pdf") ?? 0;
      acquirePdfDocument("/v/paper.pdf", first).release();
      useEditorStore.getState().closeTab("a");
      expect(version("/v/paper.pdf")).toBeUndefined();

      open("b", "/v/paper.pdf", "");
      const second = version("/v/paper.pdf") ?? 0;
      acquirePdfDocument("/v/paper.pdf", second).release();

      expect(second).toBeGreaterThan(first);
      expect(loads).toEqual([first, second]);
    } finally {
      __setPdfDocumentLoaderForTest(null);
      __resetPdfDocumentCacheForTest();
    }
  });

  it("keeps the version across a rename, which is the same file", () => {
    open("a", "/v/old.pdf", "");
    const before = version("/v/old.pdf");
    expect(before).toBeGreaterThan(0);
    useFileStore
      .getState()
      .renameFileEntry("/v/old.pdf", "/v/new.pdf", "new.pdf");
    useEditorStore.getState().renameTab("/v/old.pdf", "/v/new.pdf", "new.pdf");
    expect(version("/v/new.pdf")).toBe(before);
  });

  it("keeps the version when a second tab shows a file one already shows", () => {
    open("a", "/v/same.pdf", "");
    const before = version("/v/same.pdf");
    // openTab 은 같은 경로의 탭을 다시 만들지 않는다 — Save As 가 그렇게 만드는 모양으로 넣는다.
    useEditorStore.setState((s) => ({
      tabs: [...s.tabs, tab("b", "/v/same.pdf")],
    }));
    expect(version("/v/same.pdf")).toBe(before);
  });
});
