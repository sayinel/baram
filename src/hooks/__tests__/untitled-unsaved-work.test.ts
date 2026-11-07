// §3.6 제목 없는 탭(`filePath: ""`)의 글은 저장 확인을 빠져나갔다.
//
// 빠져나간 자리와 고친 자리를 여기서 하나씩 고정한다.
//   1. WYSIWYG 입력이 dirty 를 세우지 않았다(`use-auto-save.ts` 의 update 핸들러가 경로를 물었다).
//   2. 탭을 옮길 때 글이 `openFiles` 에 적히지 않아(`save-outgoing-tab.ts`), 배경 탭의 Save As 가
//      빈 파일을 쓰고 성공을 보고했다.
//   3. 배경 탭의 저장이 소스 버퍼도 keep-alive 편집기도 읽지 않았다(`use-close-guard.ts`).
//   4. 활성 탭의 저장 결과를 `isDirty` 로만 판정해, 소스 모드에서 Save As 를 취소해도 저장됐다고
//      보고했다(같은 파일). 파일 탭의 쓰기 실패도 같다.
//   5. 소스 모드에서 돌아올 때 편집 표시만 지우고 dirty 로 넘기지 않았다(`use-source-mode.ts`).
//      문서를 바꾸는 `view.updateState` 는 `update` 를 내지 않아 자동 저장 훅이 보지 못한다.
//      파일 탭도 같아서, 디바운스 안에 돌아오면 쓰이지 않은 글이 깨끗한 탭으로 남았다.
//
// dirty 가 서면 그것을 믿고 저장하는 길이 열리므로, 저장이 틀린 글을 쓰지 않는 것도 함께 고정한다.
//   6. 채우는 중인 문서를 쓰면 파일이 잘린다(`handleSave` · `handleSaveAs` · 자동 저장 타이머).
//   7. 아직 설치되지 않은 탭에서는 에디터에 다른 탭의 문서가 남아 있다. 그 탭을 떠나면 그 글이 이 탭의
//      글로 적혔고(`save-outgoing-tab.ts`), 저장하면 이 탭의 파일에 쓰였다.
//   8. 채우는 중에 소스 모드로 가면 앞부분만 있는 문서가 버퍼가 되어 저장 관문을 지나갔다.
import { useRef } from "react";

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writeFile = vi.fn(async (_path: string, _content: string) => {});

vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  updateFileIndex: vi.fn(async () => undefined),
  writeFile: (path: string, content: string) => writeFile(path, content),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));

// Holds the parse open, so a test can act while a large document is on its way in.
const parse = vi.hoisted(() => ({
  held: false,
  release: (() => {}) as () => void,
}));
vi.mock("../../pipeline/parse-async", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../pipeline/parse-async")>();
  return {
    ...actual,
    parseMdastAsync: (source: string) =>
      parse.held
        ? new Promise((resolve) => {
            parse.release = () => resolve({ children: [], type: "root" });
          })
        : actual.parseMdastAsync(source),
  };
});

import { save } from "@tauri-apps/plugin-dialog";

import type { EditorTab } from "../../stores/editor/editor";
import type { TabSwitchContext } from "../tab-switching/types";
import type { EditorState } from "@tiptap/pm/state";

import { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";

import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { isTabUnsaved, useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import {
  clearOriginalDoc,
  isTabLoading,
  loadedTabId,
  markContentLoaded,
  setTabLoading,
  shouldSkipDirty,
} from "../../utils/editor/programmatic-update";
import { serializeLiveDoc } from "../../utils/editor/serialize-live-doc";
import { saveOutgoingTab } from "../tab-switching/save-outgoing-tab";
import { useAutoSave } from "../use-auto-save";
import { requestReload, saveDirtyTab } from "../use-close-guard";
import { useFileOperations } from "../use-file-operations";
import { useKeepaliveEditors } from "../use-keepalive-editors";
import {
  createKeepalivePool,
  LARGE_DOC_BLOCK_THRESHOLD,
} from "../use-large-doc-keepalive";
import { useSourceMode } from "../use-source-mode";
import { useTabSwitching } from "../use-tab-switching";

interface AppendHandle {
  handle: { cancel(): void };
  tabId: string;
}

const ID = "untitled";
const PATH = "/v/note.md";

function fileTab(over: Partial<EditorTab> = {}): EditorTab {
  return untitledTab({ filePath: PATH, title: "note.md", ...over });
}

function show(tab: EditorTab): void {
  useEditorStore.setState({ activeTabId: tab.id, tabs: [tab] });
}

function unsaved(): boolean {
  const { sourceEditedTabs, tabs } = useEditorStore.getState();
  return isTabUnsaved(tabs[0], sourceEditedTabs);
}

function untitledTab(over: Partial<EditorTab> = {}): EditorTab {
  return {
    contextId: "",
    filePath: "",
    id: ID,
    isDirty: false,
    isPinned: false,
    title: "Untitled",
    type: "file",
    ...over,
  };
}

let editor: Editor;

beforeEach(() => {
  writeFile.mockReset();
  writeFile.mockResolvedValue(undefined);
  vi.mocked(save).mockReset();
  parse.held = false;
  clearOriginalDoc(ID);
  useEditorStore.setState({
    activeTabId: null,
    documentSurfaceAccess: null,
    mruOrder: [],
    sourceBufferAccess: null,
    sourceEditedTabs: [],
    sourceModeTabs: [],
    staleContentTabs: [],
    tabs: [],
  });
  useFileStore.setState({ fileMtimes: new Map(), openFiles: new Map() });
  useSettingsStore.setState({ autoSave: true, autoSaveDelay: 2000 });
  useUIStore.setState({ unsavedModal: null });
  editor = new Editor({ extensions: createBaramExtensions() });
});

afterEach(() => {
  vi.useRealTimers();
  if (!editor.isDestroyed) editor.destroy();
});

describe("typing in the document of a tab with no path", () => {
  function type(): void {
    markContentLoaded(ID);
    act(() => {
      editor.commands.insertContent("draft");
    });
  }

  // 이것을 실패시키는 것: update 핸들러가 `markDirty` 앞에서 `!tab.filePath` 로 돌아간다.
  it("counts as unsaved", () => {
    show(untitledTab());
    renderHook(() => useAutoSave(editor));

    type();

    expect(unsaved()).toBe(true);
  });

  // 이것을 실패시키는 것: 경로 없는 탭에도 저장 타이머를 걸면 `writeFile("", …)` 이 나간다.
  it("arms no auto-save: there is nowhere to write", () => {
    vi.useFakeTimers();
    show(untitledTab());
    renderHook(() => useAutoSave(editor));

    type();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(writeFile).not.toHaveBeenCalled();
  });

  // The pair: the same timer does write a tab that has a path.
  it("a tab with a path is written by that timer", () => {
    vi.useFakeTimers();
    show(fileTab());
    renderHook(() => useAutoSave(editor));

    type();
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(writeFile).toHaveBeenCalledOnce();
    expect(writeFile.mock.calls[0][0]).toBe(PATH);
  });

  // 이것을 실패시키는 것: `save()` 의 `isTabLoading` 검사를 지우면 타이머가 채우는 중인 문서를 쓴다.
  it("a timer armed before a progressive load does not write during it", () => {
    vi.useFakeTimers();
    show(fileTab());
    renderHook(() => useAutoSave(editor));

    type();
    setTabLoading(ID, true);
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(writeFile).not.toHaveBeenCalled();
    expect(unsaved()).toBe(true);
  });

  // 이것을 실패시키는 것: `save()` 의 `loadedTabId` 검사를 지우면 앞 탭의 글이 이 탭의 파일에 쓰인다.
  it("a timer firing before the tab is installed again does not write", () => {
    vi.useFakeTimers();
    show(fileTab());
    renderHook(() => useAutoSave(editor));

    type();
    markContentLoaded("the-tab-before");
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(writeFile).not.toHaveBeenCalled();
  });

  // 이것을 실패시키는 것: `isFileTab` 대신 탭이 있는지만 물으면 그래프 탭이 dirty 가 된다.
  it("leaves a graph tab alone, which has no path either", () => {
    show(untitledTab({ type: "graph" }));
    renderHook(() => useAutoSave(editor));

    type();

    expect(useEditorStore.getState().tabs[0].isDirty).toBe(false);
  });

  // 이것을 실패시키는 것: `loadedTabId` 검사를 지우면 떠나는 문서의 update 가 새 탭의 표시를 세운다.
  // 저장할 곳이 없는 탭은 그 표시를 내려 줄 것이 없다.
  it("ignores an update from the document still being left", () => {
    show(untitledTab());
    renderHook(() => useAutoSave(editor));
    markContentLoaded("the-tab-before");

    act(() => {
      editor.commands.insertContent("not this tab's text");
    });

    expect(unsaved()).toBe(false);
  });

  // 이것을 실패시키는 것: `editor.isEmpty` 갈래를 지우면 비운 탭이 계속 저장을 묻는다.
  it("stops counting once the tab is empty again", () => {
    show(untitledTab());
    renderHook(() => useAutoSave(editor));

    type();
    expect(unsaved()).toBe(true);
    act(() => {
      editor.commands.clearContent(true);
    });

    expect(unsaved()).toBe(false);
  });

  // 이것을 실패시키는 것: 기준선과 같으면 표시를 그대로 두는 예전 분기. 복원하면 글이 기준선이 되므로,
  // 전부 지웠다가 되돌린 초안이 깨끗한 탭이 되어 묻지 않고 사라진다.
  it("counts again when an undo brings the text back into a restored tab", () => {
    show(untitledTab());
    renderHook(() => useAutoSave(editor));
    // What coming back to the tab does: its text is in the document, and is the baseline.
    editor.commands.setContent("<p>draft</p>");
    editor.view.dispatch(closeHistory(editor.state.tr));
    markContentLoaded(ID);

    act(() => {
      editor.chain().selectAll().deleteSelection().run();
    });
    expect(unsaved()).toBe(false);
    act(() => {
      editor.commands.undo();
    });

    expect(editor.state.doc.textContent).toContain("draft");
    expect(unsaved()).toBe(true);
  });

  // 이것을 실패시키는 것: 채우는 중의 update 도 표시를 정하면, 빈 첫 조각이 초안의 표시를 내린다.
  it("leaves the mark alone while the document is being filled", () => {
    editor.commands.setContent("<p>draft</p>");
    show(untitledTab({ isDirty: true }));
    const updates = vi.fn();
    editor.on("update", updates);
    renderHook(() => useAutoSave(editor));
    markContentLoaded(ID);
    setTabLoading(ID, true);

    act(() => {
      editor.commands.clearContent(true);
    });

    expect(updates).toHaveBeenCalled();
    expect(unsaved()).toBe(true);
  });

  // Blank lines serialize to nothing, so there is nothing to ask about.
  it("does not count a document of empty paragraphs", () => {
    show(untitledTab());
    renderHook(() => useAutoSave(editor));
    markContentLoaded(ID);

    act(() => {
      editor.commands.setContent("<p></p><p></p>");
    });

    expect(editor.state.doc.childCount).toBe(2);
    expect(unsaved()).toBe(false);
  });

  // 이것을 실패시키는 것: `editor.isEmpty` 만 보면 제목만 쓴 콜아웃을 비었다고 읽어 묻지 않고 버린다.
  it("counts a callout with only a title, which isEmpty calls empty", () => {
    show(untitledTab());
    renderHook(() => useAutoSave(editor));
    markContentLoaded(ID);

    act(() => {
      editor.commands.setContent(
        markdownToProsemirror(
          "> [!warning] Important note\n",
          editor.schema,
        ).toJSON(),
      );
    });

    expect(editor.isEmpty).toBe(true);
    expect(unsaved()).toBe(true);
  });

  // The pair: a file tab emptied this way is a real edit to that file.
  it("a file tab emptied again still counts", () => {
    show(fileTab());
    renderHook(() => useAutoSave(editor));

    type();
    act(() => {
      editor.commands.clearContent(true);
    });

    expect(unsaved()).toBe(true);
  });

  // 끝에서 끝까지: 입력이 실제로 저장 확인을 부른다.
  it("makes a reload ask first", async () => {
    show(untitledTab());
    renderHook(() => useAutoSave(editor));

    type();
    await requestReload();

    expect(useUIStore.getState().unsavedModal).toEqual({ intent: "reload" });
  });

  it("makes Cmd+W ask first", () => {
    show(untitledTab());
    renderHook(() => useAutoSave(editor));
    const ops = renderHook(() =>
      useFileOperations({
        editor,
        getSourceBuffer: () => "",
        sourceModeTabs: new Set(),
      }),
    );

    type();
    act(() => {
      ops.result.current.handleCloseTab();
    });

    expect(useUIStore.getState().unsavedModal).toEqual({
      intent: "closeTab",
      tabId: ID,
    });
    expect(useEditorStore.getState().tabs).toHaveLength(1);
  });
});

describe("opening a new tab through the real tab switch", () => {
  function app() {
    const hook = renderHook(() => {
      const appendHandleRef = useRef(null);
      const isNavBackForwardRef = useRef(false);
      const pool = useRef(createKeepalivePool());
      const source = useSourceMode({ editor });
      useAutoSave(editor);
      useTabSwitching({
        appendHandleRef,
        createKeepaliveEditor: () => editor,
        editor,
        editorStateCache: source.editorStateCache,
        getSourceBuffer: source.getSourceBuffer,
        isNavBackForwardRef,
        keepalive: pool.current,
        onActiveEditorChange: vi.fn(),
        scrollOffsets: { current: new Map() },
        setFindReplaceMode: vi.fn(),
        setFindReplaceOpen: vi.fn(),
        setIsParsing: vi.fn(),
        setSourceBuffer: source.setSourceBuffer,
        sourceModeTabs: source.sourceModeTabs,
      });
      return useFileOperations({
        editor,
        getSourceBuffer: source.getSourceBuffer,
        sourceModeTabs: source.sourceModeTabs,
      });
    });
    return { hook };
  }

  // 이것을 실패시키는 것: 새 탭을 여는 길에 문서를 바꾸는 transaction 이 생겨 dirty 로 잡히면 된다.
  // 예전 시험은 `setContent("")` 를 썼는데, 그 호출은 `update` 를 내지 않아 실패할 수 없었다.
  it("leaves it clean until something is typed", async () => {
    const { hook } = app();

    act(() => {
      hook.result.current.handleNewFile();
    });
    const id = useEditorStore.getState().activeTabId;
    await vi.waitFor(() => expect(loadedTabId()).toBe(id));

    expect(unsaved()).toBe(false);

    // The pair: the installed tab does take an edit, so "clean" above is not a dead handler.
    act(() => {
      editor.commands.insertContent("x");
    });
    expect(unsaved()).toBe(true);
  });
});

describe("moving away from a tab", () => {
  function context(over: Partial<TabSwitchContext> = {}): TabSwitchContext {
    return {
      editor,
      editorStateCache: { current: new Map() },
      getSourceBuffer: () => "",
      keepalive: { get: () => undefined },
      sourceModeTabs: new Set(),
      ...over,
    } as unknown as TabSwitchContext;
  }

  // 이것을 실패시키는 것: `saveOutgoingTab` 이 `prevTab.filePath` 가 있을 때만 `openFiles` 에 적는다.
  it("keeps an untitled tab's text where a Save As in the background reads it", () => {
    useEditorStore.setState({ tabs: [untitledTab()] });
    editor.commands.setContent("<p>draft</p>");
    markContentLoaded(ID);

    saveOutgoingTab(context(), ID);

    const held = useFileStore.getState().openFiles.get(ID);
    expect(held).toContain("draft");
    expect(held).toBe(serializeLiveDoc(editor));
  });

  it("takes the source buffer when the tab is in source mode", () => {
    useEditorStore.setState({ tabs: [untitledTab()] });
    markContentLoaded("the-tab-before");

    saveOutgoingTab(
      context({
        getSourceBuffer: () => "typed in source",
        sourceModeTabs: new Set([ID]),
      }),
      ID,
    );

    expect(useFileStore.getState().openFiles.get(ID)).toBe("typed in source");
  });

  // 이것을 실패시키는 것: `holdsDocument` 검사를 지우면 에디터에 남은 앞 탭의 글이 이 탭 이름으로 적힌다.
  // 파일 탭이면 돌아왔을 때 그 글이 보이고, 다음 저장이 파일에 쓴다.
  it.each([
    ["an untitled tab", untitledTab(), ID],
    ["a file tab", fileTab(), PATH],
  ])("leaves %s alone until its document is installed", (_name, tab, key) => {
    useEditorStore.setState({ tabs: [tab] });
    useFileStore.setState({ openFiles: new Map([[key, "its own text"]]) });
    editor.commands.setContent("<p>the tab before</p>");
    markContentLoaded("the-tab-before");
    const ctx = context();

    saveOutgoingTab(ctx, ID);

    expect(useFileStore.getState().openFiles.get(key)).toBe("its own text");
    expect(ctx.editorStateCache.current.has(ID)).toBe(false);
  });

  // The pair: once installed, the same call caches and serializes it.
  it("caches a file tab whose document is installed", () => {
    useEditorStore.setState({ tabs: [fileTab()] });
    editor.commands.setContent("<p>installed</p>");
    markContentLoaded(ID);
    const ctx = context();

    saveOutgoingTab(ctx, ID);

    expect(useFileStore.getState().openFiles.get(PATH)).toContain("installed");
    expect(ctx.editorStateCache.current.has(ID)).toBe(true);
  });

  // 끝에서 끝까지: 예전에는 빈 파일을 쓰고 성공을 보고해, 그대로 닫기 · 종료로 갔다.
  it("a Save As then writes that text, not an empty file", async () => {
    const tab = untitledTab({ isDirty: true });
    useEditorStore.setState({ activeTabId: "other", tabs: [tab] });
    editor.commands.setContent("<p>draft</p>");
    markContentLoaded(ID);
    saveOutgoingTab(context(), ID);
    vi.mocked(save).mockResolvedValue("/v/new.md");

    const ok = await saveDirtyTab(tab, "other", vi.fn());

    expect(ok).toBe(true);
    expect(writeFile).toHaveBeenCalledOnce();
    expect(writeFile.mock.calls[0][1]).toContain("draft");
  });
});

describe("saving a tab in the background", () => {
  function access(text: string) {
    return { getSourceBuffer: () => text, setSourceBuffer: vi.fn() };
  }

  // 이것을 실패시키는 것: 배경 Untitled 의 Save As 가 `openFiles` 만 읽는다. 버퍼가 진실일 때 낡은 글을 쓴다.
  it("a Save As writes the source buffer and clears the mark", async () => {
    const tab = untitledTab();
    useEditorStore.setState({
      activeTabId: "other",
      sourceBufferAccess: access("typed in source"),
      sourceEditedTabs: [ID],
      tabs: [tab],
    });
    useFileStore.setState({ openFiles: new Map([[ID, "older text"]]) });
    vi.mocked(save).mockResolvedValue("/v/new.md");

    const ok = await saveDirtyTab(tab, "other", vi.fn());

    expect(ok).toBe(true);
    expect(writeFile).toHaveBeenCalledWith("/v/new.md", "typed in source");
    expect(useEditorStore.getState().sourceEditedTabs).toEqual([]);
    expect(useFileStore.getState().openFiles.get("/v/new.md")).toBe(
      "typed in source",
    );
    // The text moved to its path: nothing keeps a second copy under the old key.
    expect(useFileStore.getState().openFiles.has(ID)).toBe(false);
  });

  function pool(complete: boolean) {
    return {
      editor,
      editorStateCache: new Map(),
      isKeepaliveComplete: () => complete,
      keepaliveEditor: () => editor,
    };
  }

  // 이것을 실패시키는 것: `backgroundText` 가 keep-alive 편집기를 읽지 않으면 `openFiles` 의 옛 글을 쓰고
  // 탭을 깨끗하다고 표시한다. 큰 문서의 편집은 그 편집기에만 있다.
  it.each([
    ["an untitled tab", untitledTab({ isDirty: true }), ID],
    ["a file tab", fileTab({ isDirty: true }), PATH],
  ])(
    "%s in the keep-alive pool writes the pool's text",
    async (_n, tab, key) => {
      useEditorStore.setState({
        activeTabId: "other",
        documentSurfaceAccess: pool(true),
        tabs: [tab],
      });
      useFileStore.setState({ openFiles: new Map([[key, "older text"]]) });
      editor.commands.setContent("<p>newer text in the pool</p>");
      vi.mocked(save).mockResolvedValue("/v/new.md");

      const ok = await saveDirtyTab(tab, "other", vi.fn());

      expect(ok).toBe(true);
      expect(writeFile.mock.calls[0][1]).toContain("newer text in the pool");
    },
  );

  // 이것을 실패시키는 것: stale 을 묻지 않으면 사용자가 받아들인 외부 변경을 옛 글로 덮는다.
  it("does not trust a pool whose file changed underneath it", async () => {
    const tab = fileTab({ isDirty: true });
    useEditorStore.setState({
      activeTabId: "other",
      documentSurfaceAccess: pool(true),
      staleContentTabs: [ID],
      tabs: [tab],
    });
    useFileStore.setState({ openFiles: new Map([[PATH, "accepted text"]]) });
    editor.commands.setContent("<p>older text in the pool</p>");

    await saveDirtyTab(tab, "other", vi.fn());

    expect(writeFile).toHaveBeenCalledWith(PATH, "accepted text");
  });

  // 이것을 실패시키는 것: 저장한 글을 캐시에 맞추지 않으면 다음 로드가 저장 전 글을 읽어 편집을 지운다.
  it("keeps the cache in step with the pool's text it wrote", async () => {
    const tab = fileTab({ isDirty: true });
    useEditorStore.setState({
      activeTabId: "other",
      documentSurfaceAccess: pool(true),
      tabs: [tab],
    });
    useFileStore.setState({ openFiles: new Map([[PATH, "older text"]]) });
    editor.commands.setContent("<p>newer text</p>");

    await saveDirtyTab(tab, "other", vi.fn());

    expect(useFileStore.getState().openFiles.get(PATH)).toContain("newer text");
  });

  // 이것을 실패시키는 것: 첫 조건이 편집 표시만 보면, 일정 쓰기처럼 `isDirty` 만 세운 소스 모드 탭의 저장이
  // 그 쓰기를 잃는다.
  it("reads the buffer of any tab in source mode, marked or not", async () => {
    const tab = fileTab({ isDirty: true });
    useEditorStore.setState({
      activeTabId: "other",
      sourceBufferAccess: access("after a task write"),
      sourceModeTabs: [ID],
      tabs: [tab],
    });
    useFileStore.setState({ openFiles: new Map([[PATH, "before it"]]) });

    await saveDirtyTab(tab, "other", vi.fn());

    expect(writeFile).toHaveBeenCalledWith(PATH, "after a task write");
  });

  // 이것을 실패시키는 것: `?? ""` 로 돌아가면 밖에서 지운 파일을 빈 파일로 되살리고 저장됐다고 보고한다.
  it("writes nothing and reports not saved when no text is held", async () => {
    const tab = fileTab({ isDirty: true });
    useEditorStore.setState({ activeTabId: "other", tabs: [tab] });

    const ok = await saveDirtyTab(tab, "other", vi.fn());

    expect(ok).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
    expect(unsaved()).toBe(true);
  });

  // 이것을 실패시키는 것: Save As 갈래의 `null` 검사를 지우면 글을 찾지 못한 채 빈 파일을 새로 만든다.
  it("makes no file when a tab with no path holds no text", async () => {
    const tab = untitledTab({ isDirty: true });
    useEditorStore.setState({ activeTabId: "other", tabs: [tab] });
    vi.mocked(save).mockResolvedValue("/v/copy.md");

    const ok = await saveDirtyTab(tab, "other", vi.fn());

    expect(ok).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });

  // 이것을 실패시키는 것: 복귀용 상태를 보지 않으면 밖에서 파일이 지워진 탭의 글을 쓸 길이 없어 Don't Save 만 남는다.
  it("takes the text from the state kept for the tab if nothing else has it", async () => {
    const tab = fileTab({ isDirty: true });
    editor.commands.setContent("<p>kept for coming back</p>");
    useEditorStore.setState({
      activeTabId: "other",
      documentSurfaceAccess: {
        ...pool(false),
        editorStateCache: new Map([[ID, editor.state]]),
      },
      tabs: [tab],
    });

    const ok = await saveDirtyTab(tab, "other", vi.fn());

    expect(ok).toBe(true);
    expect(writeFile.mock.calls[0][1]).toContain("kept for coming back");
  });

  // The pair: `openFiles` is the later of the two. A change accepted from disk went there.
  it("prefers `openFiles` to the state kept for the tab", async () => {
    const tab = fileTab({ isDirty: true });
    editor.commands.setContent("<p>kept for coming back</p>");
    useEditorStore.setState({
      activeTabId: "other",
      documentSurfaceAccess: {
        ...pool(false),
        editorStateCache: new Map([[ID, editor.state]]),
      },
      tabs: [tab],
    });
    useFileStore.setState({ openFiles: new Map([[PATH, "accepted text"]]) });

    await saveDirtyTab(tab, "other", vi.fn());

    expect(writeFile).toHaveBeenCalledWith(PATH, "accepted text");
  });

  // The pair: a pool entry the load never finished holds a partial document.
  it("does not trust a pool entry that was never filled", async () => {
    const tab = fileTab({ isDirty: true });
    useEditorStore.setState({
      activeTabId: "other",
      documentSurfaceAccess: pool(false),
      tabs: [tab],
    });
    useFileStore.setState({ openFiles: new Map([[PATH, "whole text"]]) });
    editor.commands.setContent("<p>first chunk</p>");

    await saveDirtyTab(tab, "other", vi.fn());

    expect(writeFile).toHaveBeenCalledWith(PATH, "whole text");
  });
});

describe("saving the active tab", () => {
  beforeEach(() => {
    markContentLoaded(ID);
  });

  function ops(tab: EditorTab, inSourceMode: boolean, text = "") {
    useEditorStore.setState({
      activeTabId: tab.id,
      sourceEditedTabs: inSourceMode ? [tab.id] : [],
      sourceModeTabs: inSourceMode ? [tab.id] : [],
      tabs: [tab],
    });
    return renderHook(() =>
      useFileOperations({
        editor,
        getSourceBuffer: () => text,
        sourceModeTabs: new Set(inSourceMode ? [tab.id] : []),
      }),
    ).result;
  }

  function activeSave(tab: EditorTab, text: string) {
    const result = ops(tab, true, text);
    return saveDirtyTab(tab, tab.id, result.current.handleSave);
  }

  // 이것을 실패시키는 것: 활성 탭의 결과를 `isDirty` 로만 본다. 소스 모드 편집은 그것을 세우지 않으므로
  // 취소해도 저장된 것으로 보고되고, 표시까지 지운 채 닫기 · 종료로 간다.
  it("a Save As that is cancelled reports not saved and keeps the mark", async () => {
    vi.mocked(save).mockResolvedValue(null);

    const ok = await activeSave(untitledTab(), "typed in source");

    expect(ok).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
    expect(useEditorStore.getState().sourceEditedTabs).toEqual([ID]);
  });

  it("a Save As that goes through reports saved and clears the mark", async () => {
    vi.mocked(save).mockResolvedValue("/v/new.md");

    const ok = await activeSave(untitledTab(), "typed in source");

    expect(ok).toBe(true);
    expect(writeFile).toHaveBeenCalledWith("/v/new.md", "typed in source");
    expect(useEditorStore.getState().sourceEditedTabs).toEqual([]);
  });

  it("a file tab whose write fails reports not saved and keeps the mark", async () => {
    writeFile.mockRejectedValue(new Error("disk full"));

    const ok = await activeSave(fileTab(), "typed in source");

    expect(ok).toBe(false);
    expect(useEditorStore.getState().sourceEditedTabs).toEqual([ID]);
  });

  // 이것을 실패시키는 것: `handleSave` 의 `isTabLoading` 검사를 지우면 앞부분만 있는 문서를 파일에 쓴다.
  it("writes nothing while the document is still being filled", async () => {
    const tab = fileTab({ isDirty: true });
    const result = ops(tab, false);
    editor.commands.setContent("<p>first chunk</p>");
    setTabLoading(ID, true);

    const ok = await saveDirtyTab(tab, ID, result.current.handleSave);

    expect(ok).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
    expect(unsaved()).toBe(true);
  });

  // 이것을 실패시키는 것: `loadedTabId` 검사를 지우면 에디터에 남은 앞 탭의 글이 이 탭의 파일에 쓰인다.
  // 파싱이 도는 동안 열려 있는 틈이고, 방금 연 깨끗한 파일도 덮인다.
  it("writes nothing before the tab's document is installed", async () => {
    const tab = fileTab({ isDirty: true });
    const result = ops(tab, false);
    editor.commands.setContent("<p>the tab before</p>");
    markContentLoaded("the-tab-before");

    const ok = await saveDirtyTab(tab, ID, result.current.handleSave);

    expect(ok).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });

  // 이것을 실패시키는 것: `handleSaveAs` 가 같은 검사를 하지 않으면 앞 탭의 글이 이 탭의 사본이 된다.
  it("makes no copy before the tab's document is installed", async () => {
    const result = ops(fileTab({ isDirty: true }), false);
    editor.commands.setContent("<p>the tab before</p>");
    markContentLoaded("the-tab-before");
    vi.mocked(save).mockResolvedValue("/v/copy.md");

    await act(async () => {
      await result.current.handleSaveAs();
    });

    expect(writeFile).not.toHaveBeenCalled();
  });

  // 이것을 실패시키는 것: 닫을 때 표시를 지우지 않으면, 같은 id 로 다시 연 탭이 파싱 동안 설치된 것으로 읽혀
  // 마지막 탭을 닫아 빈 편집기의 빈 글이 파일을 덮는다.
  it("writes nothing for a tab opened again under the id of a closed one", async () => {
    const tab = fileTab({ isDirty: true });
    const result = ops(tab, false);
    clearOriginalDoc(ID);

    const ok = await saveDirtyTab(tab, ID, result.current.handleSave);

    expect(ok).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });

  // The pair: closing another tab says nothing about this one.
  it("is not put off by another tab closing", () => {
    clearOriginalDoc("another-tab");

    expect(loadedTabId()).toBe(ID);
  });

  // The pair: once installed, the same save writes the document.
  it("writes the document once it is installed", async () => {
    const tab = fileTab({ isDirty: true });
    const result = ops(tab, false);
    editor.commands.setContent("<p>its own text</p>");

    const ok = await saveDirtyTab(tab, ID, result.current.handleSave);

    expect(ok).toBe(true);
    expect(writeFile.mock.calls[0][1]).toContain("its own text");
  });

  it("offers no Save As of it either", async () => {
    const result = ops(fileTab({ isDirty: true }), false);
    setTabLoading(ID, true);

    await act(async () => {
      await result.current.handleSaveAs();
    });

    expect(save).not.toHaveBeenCalled();
  });

  // The pair: a tab saved from its buffer does not read the document, so it can still save.
  it("a tab in source mode still saves from its buffer during a load", async () => {
    setTabLoading(ID, true);

    const ok = await activeSave(fileTab(), "typed in source");

    expect(ok).toBe(true);
    expect(writeFile).toHaveBeenCalledWith(PATH, "typed in source");
  });
});

describe("coming back from source mode", () => {
  const LARGE = Array.from(
    { length: LARGE_DOC_BLOCK_THRESHOLD + 1 },
    (_, i) => `paragraph ${i}\n`,
  ).join("\n");

  function inSourceMode(tab: EditorTab, text: string, edited: boolean) {
    useEditorStore.setState({
      activeTabId: tab.id,
      sourceEditedTabs: edited ? [tab.id] : [],
      sourceModeTabs: [tab.id],
      tabs: [tab],
    });
    const hook = renderHook(() => useSourceMode({ editor }));
    act(() => {
      hook.result.current.setSourceBuffer(tab.id, text);
    });
    return hook;
  }

  // 이것을 실패시키는 것: 복귀 때 편집 표시만 지우면 글은 문서에 있는데 탭은 깨끗하다.
  it.each([
    ["a tab with no path", untitledTab()],
    ["a file tab with auto-save off", fileTab()],
  ])("carries an edit over as dirty on %s", (_name, tab) => {
    useSettingsStore.setState({ autoSave: false });
    const hook = inSourceMode(tab, "typed in source\n", true);

    act(() => {
      hook.result.current.toggleSourceMode();
    });

    expect(editor.state.doc.textContent).toContain("typed in source");
    expect(useEditorStore.getState().sourceEditedTabs).toEqual([]);
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
    expect(unsaved()).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });

  // 이것을 실패시키는 것: 복귀가 지운 타이머를 아무도 대신하지 않으면 저장되지 않은 채 점만 남는다.
  it("does the save the switch cancelled when auto-save is on", async () => {
    const hook = inSourceMode(fileTab(), "typed in source\n", true);

    act(() => {
      hook.result.current.toggleSourceMode();
    });

    await vi.waitFor(() =>
      expect(writeFile).toHaveBeenCalledWith(PATH, "typed in source\n"),
    );
    await vi.waitFor(() => expect(unsaved()).toBe(false));
  });

  it("has nowhere to save a tab with no path, so it stays dirty", async () => {
    const hook = inSourceMode(untitledTab(), "typed in source\n", true);

    act(() => {
      hook.result.current.toggleSourceMode();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(writeFile).not.toHaveBeenCalled();
    expect(unsaved()).toBe(true);
  });

  // 이것을 실패시키는 것: 작은 복귀가 채우기를 멈추지 않으면 남은 조각이 설치한 문서 끝에 더 붙어, 저장이 글을 겹쳐 쓴다.
  it("stops a load still filling the document it replaces", () => {
    const cancel = vi.fn();
    const appendHandleRef: { current: AppendHandle | null } = {
      current: { handle: { cancel }, tabId: ID },
    };
    useEditorStore.setState({
      activeTabId: ID,
      sourceEditedTabs: [],
      sourceModeTabs: [ID],
      tabs: [fileTab()],
    });
    setTabLoading(ID, true);
    const hook = renderHook(() => useSourceMode({ appendHandleRef, editor }));
    act(() => {
      hook.result.current.setSourceBuffer(ID, "short\n");
    });

    act(() => {
      hook.result.current.toggleSourceMode();
    });

    expect(cancel).toHaveBeenCalledOnce();
    expect(appendHandleRef.current).toBeNull();
    expect(isTabLoading(ID)).toBe(false);
  });

  // 이것을 실패시키는 것: 표시를 남기지 않으면 글이 보이는데 Cmd+S · 자동 저장 · 떠날 때의 보관이 모두 거절한다.
  it("says the document is installed if the tab came back without one", () => {
    markContentLoaded("the-tab-before");
    const hook = inSourceMode(fileTab(), "typed in source\n", true);

    act(() => {
      hook.result.current.toggleSourceMode();
    });

    expect(loadedTabId()).toBe(ID);
  });

  // The pair: a tab already installed keeps its baseline, or this text would read as saved.
  it("leaves the baseline of a tab already installed", () => {
    markContentLoaded(ID);
    expect(shouldSkipDirty(ID, editor.state.doc)).toBe(true);
    const hook = inSourceMode(fileTab(), "typed in source\n", true);

    act(() => {
      hook.result.current.toggleSourceMode();
    });

    expect(shouldSkipDirty(ID, editor.state.doc)).toBe(false);
  });

  // 경로 없는 탭은 담긴 것이 없으면 잃을 것도 없다.
  it("leaves a tab with no path clean if it was emptied in source mode", () => {
    const hook = inSourceMode(untitledTab({ isDirty: true }), "  \n", true);

    act(() => {
      hook.result.current.toggleSourceMode();
    });

    expect(unsaved()).toBe(false);
  });

  // The pair: looking at the source changes nothing, so it must stay clean and write nothing.
  it("leaves a tab clean when nothing was edited there", async () => {
    const hook = inSourceMode(fileTab(), "", false);

    act(() => {
      hook.result.current.toggleSourceMode();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(unsaved()).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });

  describe("with a large document, which arrives in pieces", () => {
    beforeEach(() => {
      parse.held = true;
      useSettingsStore.setState({ autoSave: false });
    });

    // 이것을 실패시키는 것: 키를 `currentTab.id` 로만 쓰면 파일 탭의 글이 경로로 읽히지 않는다.
    it("keeps a file tab's text under its path while the document arrives", () => {
      const hook = inSourceMode(fileTab(), LARGE, true);

      act(() => {
        hook.result.current.toggleSourceMode();
      });

      expect(useFileStore.getState().openFiles.get(PATH)).toBe(LARGE);
    });

    // 이것을 실패시키는 것: `currentTab.isDirty` 를 지우면 WYSIWYG 의 저장 안 된 글이 버퍼에만 남는다.
    it("keeps it too when the unsaved work came from before source mode", () => {
      const hook = inSourceMode(fileTab({ isDirty: true }), LARGE, false);

      act(() => {
        hook.result.current.toggleSourceMode();
      });

      expect(useFileStore.getState().openFiles.get(PATH)).toBe(LARGE);
    });

    // The pair: a clean tab's text is the file, so nothing needs keeping.
    it("leaves the cache alone for a tab with nothing unsaved", () => {
      useFileStore.setState({ openFiles: new Map([[PATH, "the file"]]) });
      const hook = inSourceMode(fileTab(), LARGE, false);

      act(() => {
        hook.result.current.toggleSourceMode();
      });

      expect(useFileStore.getState().openFiles.get(PATH)).toBe("the file");
    });

    // 이것을 실패시키는 것: 캐시를 지우지 않으면 돌아왔을 때 소스 모드 이전 상태가 먼저 복원된다.
    it("drops the state cached from before source mode", () => {
      const hook = inSourceMode(fileTab(), LARGE, true);
      hook.result.current.editorStateCache.current.set(ID, editor.state);

      act(() => {
        hook.result.current.toggleSourceMode();
      });

      expect(hook.result.current.editorStateCache.current.has(ID)).toBe(false);
    });

    it("does the cancelled save here too when auto-save is on", async () => {
      useSettingsStore.setState({ autoSave: true });
      const hook = inSourceMode(fileTab(), LARGE, true);

      act(() => {
        hook.result.current.toggleSourceMode();
      });

      await vi.waitFor(() =>
        expect(writeFile).toHaveBeenCalledWith(PATH, LARGE),
      );
    });

    // 이것을 실패시키는 것: 표시를 지우지 않으면, 채우다가 떠났다 돌아온 파싱 틈의 Cmd+S 가 그대로 쓴다.
    it("does not read as installed until the document has arrived", () => {
      markContentLoaded(ID);
      const hook = inSourceMode(fileTab(), LARGE, true);

      act(() => {
        hook.result.current.toggleSourceMode();
      });

      expect(loadedTabId()).toBeNull();
    });

    // 이것을 실패시키는 것: 빠르게 다시 토글하면 앞 채우기가 이 문서 끝에 계속 붙는다.
    it("cancels a fill already going", () => {
      const cancel = vi.fn();
      const appendHandleRef: { current: AppendHandle | null } = {
        current: { handle: { cancel }, tabId: ID },
      };
      useEditorStore.setState({
        activeTabId: ID,
        sourceEditedTabs: [ID],
        sourceModeTabs: [ID],
        tabs: [fileTab()],
      });
      const hook = renderHook(() => useSourceMode({ appendHandleRef, editor }));
      act(() => {
        hook.result.current.setSourceBuffer(ID, LARGE);
      });

      act(() => {
        hook.result.current.toggleSourceMode();
      });

      expect(cancel).toHaveBeenCalledOnce();
    });

    describe("when a tab switch cancels it, even back to this tab", () => {
      function going() {
        const appendHandleRef: { current: AppendHandle | null } = {
          current: null,
        };
        useEditorStore.setState({
          activeTabId: ID,
          sourceEditedTabs: [ID],
          sourceModeTabs: [ID],
          tabs: [fileTab()],
        });
        const hook = renderHook(() =>
          useSourceMode({ appendHandleRef, editor }),
        );
        act(() => {
          hook.result.current.setSourceBuffer(ID, LARGE);
        });
        act(() => {
          hook.result.current.toggleSourceMode();
        });
        return appendHandleRef;
      }

      // 이것을 실패시키는 것: 탭 id 만 비교하면 떠났다 돌아온 탭에서 첫 채우기가 둘째 로드 위로 계속되어,
      // 채우는 중에 관문이 열리고 Cmd+S 가 파일을 자른다.
      it("does not go on after the parse", async () => {
        vi.useFakeTimers();
        editor.commands.setContent("<p>the second load's</p>");
        const ref = going();

        ref.current?.handle.cancel();
        await act(async () => {
          parse.release();
          await vi.runAllTimersAsync();
        });

        expect(editor.state.doc.textContent).toContain("the second load's");
      });

      it("does not go on after its timer", async () => {
        vi.useFakeTimers();
        editor.commands.setContent("<p>the second load's</p>");
        const ref = going();

        await act(async () => {
          parse.release();
          await Promise.resolve();
          await Promise.resolve();
        });
        expect(vi.getTimerCount()).toBeGreaterThan(0);
        ref.current?.handle.cancel();
        await act(async () => {
          await vi.runAllTimersAsync();
        });

        expect(editor.state.doc.textContent).toContain("the second load's");
      });
    });

    // 이것을 실패시키는 것: 타이머 첫 줄의 검사를 지우면 그사이 옮겨 간 탭의 에디터에 이 문서를 넣는다.
    it("does not install into the next tab if left just after the parse", async () => {
      vi.useFakeTimers();
      editor.commands.setContent("<p>the next tab</p>");
      const hook = inSourceMode(fileTab(), LARGE, true);
      act(() => {
        hook.result.current.toggleSourceMode();
      });

      await act(async () => {
        parse.release();
        await Promise.resolve();
        await Promise.resolve();
      });
      // The parse has finished and the install is waiting on its timer: this is the gap.
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      useEditorStore.setState({ activeTabId: "other" });
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(editor.state.doc.textContent).toContain("the next tab");
      expect(isTabLoading(ID)).toBe(false);
    });

    it("counts the edit from the start of the load", () => {
      const hook = inSourceMode(untitledTab(), LARGE, true);

      act(() => {
        hook.result.current.toggleSourceMode();
      });

      expect(isTabLoading(ID)).toBe(true);
      expect(useEditorStore.getState().sourceEditedTabs).toEqual([]);
      expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
    });

    // 이것을 실패시키는 것: 큰 문서 갈래에서 `setFileContent` 를 지우면 버퍼에만 있는 글을 배경 저장이
    // 읽지 못해 빈 파일을 쓰고 성공을 보고한다.
    it("a Save As in the background during the load writes the whole text", async () => {
      const tab = untitledTab();
      const hook = inSourceMode(tab, LARGE, true);
      act(() => {
        hook.result.current.toggleSourceMode();
      });
      vi.mocked(save).mockResolvedValue("/v/new.md");

      const ok = await saveDirtyTab(tab, "other", vi.fn());

      expect(ok).toBe(true);
      expect(writeFile).toHaveBeenCalledWith("/v/new.md", LARGE);
    });

    // 이것을 실패시키는 것: `handleSave` 의 `isTabLoading` 검사를 지우면 Cmd+W 가 채우는 중인 문서를 파일에
    // 쓰고 탭을 닫는다. 탭이 사라지므로 잘린 것을 볼 기회도 없다.
    it("Cmd+W during the load writes nothing and keeps the tab", async () => {
      // The tab switch installed this tab before source mode. Without it the other check would
      // stop the save and this would say nothing about the load.
      markContentLoaded(ID);
      const hook = inSourceMode(fileTab(), LARGE, true);
      act(() => {
        hook.result.current.toggleSourceMode();
      });
      // Source mode is off by now, which is what the app re-renders this hook with.
      const ops = renderHook(() =>
        useFileOperations({
          editor,
          getSourceBuffer: hook.result.current.getSourceBuffer,
          sourceModeTabs: new Set(),
        }),
      );

      await act(async () => {
        ops.result.current.handleCloseTab();
        await Promise.resolve();
      });

      expect(writeFile).not.toHaveBeenCalled();
      expect(useEditorStore.getState().tabs).toHaveLength(1);
    });

    // 이것을 실패시키는 것: 파싱 뒤 조기 반환이 표시를 지우지 않으면 `shouldSkipDirty` 가 그 뒤 편집을 전부 넘긴다.
    it("does not stay marked as loading if the tab was left before the parse ended", async () => {
      const hook = inSourceMode(fileTab(), LARGE, true);
      act(() => {
        hook.result.current.toggleSourceMode();
      });
      expect(isTabLoading(ID)).toBe(true);
      act(() => {
        useEditorStore.setState({ activeTabId: "other" });
      });

      await act(async () => {
        parse.release();
        await Promise.resolve();
      });

      await vi.waitFor(() => expect(isTabLoading(ID)).toBe(false));
    });
  });
});

describe("going into source mode", () => {
  function inWysiwyg() {
    useEditorStore.setState({
      activeTabId: ID,
      sourceEditedTabs: [],
      sourceModeTabs: [],
      tabs: [fileTab()],
    });
    return renderHook(() => useSourceMode({ editor }));
  }

  // 이것을 실패시키는 것: 검사를 지우면 앞부분만 있는 문서가 버퍼가 되고, 버퍼에서 읽는 저장은 관문을 지나
  // 파일을 자른다.
  it("waits while the document is still being filled", () => {
    const hook = inWysiwyg();
    markContentLoaded(ID);
    setTabLoading(ID, true);

    act(() => {
      hook.result.current.toggleSourceMode();
    });

    expect(useEditorStore.getState().sourceModeTabs).toEqual([]);
  });

  it("waits until the tab's document is installed", () => {
    const hook = inWysiwyg();
    markContentLoaded("the-tab-before");

    act(() => {
      hook.result.current.toggleSourceMode();
    });

    expect(useEditorStore.getState().sourceModeTabs).toEqual([]);
  });

  // The pair: a tab holding its whole document goes in.
  it("goes in once the document is whole", () => {
    const hook = inWysiwyg();
    markContentLoaded(ID);

    act(() => {
      hook.result.current.toggleSourceMode();
    });

    expect(useEditorStore.getState().sourceModeTabs).toEqual([ID]);
  });
});

describe("the keep-alive pool evicting a tab", () => {
  function access(editorStateCache: Map<string, EditorState>) {
    return {
      editor,
      editorStateCache,
      isKeepaliveComplete: () => true,
      keepaliveEditor: () => null,
    };
  }

  function evict(
    tab: EditorTab,
    complete: boolean,
    state: Partial<ReturnType<typeof useEditorStore.getState>> = {},
  ) {
    useEditorStore.setState({ sourceModeTabs: [], tabs: [tab], ...state });
    useFileStore.setState({
      openFiles: new Map([[tab.filePath || tab.id, "older text"]]),
    });
    editor.commands.setContent("<p>newer text in the pool</p>");
    const other = new Editor({ extensions: createBaramExtensions() });
    const { result } = renderHook(() => useKeepaliveEditors(null));
    act(() => {
      result.current.keepalive.acquire(ID, editor);
      if (complete) result.current.keepalive.markComplete(ID);
      result.current.keepalive.acquire("next", other);
    });
    other.destroy();
    return useFileStore.getState().openFiles.get(tab.filePath || tab.id);
  }

  // 이것을 실패시키는 것: 축출 전에 옮겨 두지 않으면 저장 안 된 글이 편집기와 함께 사라지고, 저장은 옛 글을 쓴다.
  it.each([
    ["a file tab", fileTab({ isDirty: true })],
    ["a tab with no path", untitledTab({ isDirty: true })],
  ])("keeps the unsaved text the destroyed editor held in %s", (_name, tab) => {
    expect(evict(tab, true)).toContain("newer text in the pool");
  });

  // The pairs: each of these holds nothing worth moving, or would overwrite something better.
  it("leaves a clean tab's text alone", () => {
    expect(evict(fileTab(), true)).toBe("older text");
  });

  it("does not take a document the load never finished", () => {
    expect(evict(fileTab({ isDirty: true }), false)).toBe("older text");
  });

  it("does not take the document of a tab in source mode", () => {
    const tab = fileTab({ isDirty: true });
    expect(evict(tab, true, { sourceModeTabs: [ID] })).toBe("older text");
  });

  it("does not take a document older than the file's text", () => {
    const tab = fileTab({ isDirty: true });
    expect(evict(tab, true, { staleContentTabs: [ID] })).toBe("older text");
  });

  // 이것을 실패시키는 것: 복귀용 상태를 남기면 돌아올 때 그것이 먼저 복원돼 옮겨 둔 글보다 뒤로 돌아가고, 다음 저장이 그것을 쓴다.
  it("drops a state cached before what this editor held", () => {
    const editorStateCache = new Map([[ID, editor.state]]);

    evict(fileTab(), true, { documentSurfaceAccess: access(editorStateCache) });

    expect(editorStateCache.has(ID)).toBe(false);
  });

  // The pair: an entry the load never finished held less than that state does.
  it("keeps that state for an entry the load never finished", () => {
    const editorStateCache = new Map([[ID, editor.state]]);

    evict(fileTab(), false, {
      documentSurfaceAccess: access(editorStateCache),
    });

    expect(editorStateCache.has(ID)).toBe(true);
  });

  // 이것을 실패시키는 것: 여기서 던지면 `acquire` 가 중단돼 들어오던 탭이 열리지 않는다.
  it("still makes room if the text cannot be read", () => {
    let broken = false;
    const failing = {
      destroy: vi.fn(),
      isDestroyed: false,
      get state() {
        if (broken) throw new Error("no state");
        return editor.state;
      },
    } as unknown as Editor;
    const other = new Editor({ extensions: createBaramExtensions() });
    useEditorStore.setState({
      sourceModeTabs: [],
      tabs: [fileTab({ isDirty: true })],
    });
    const { result } = renderHook(() => useKeepaliveEditors(null));
    act(() => {
      result.current.keepalive.acquire(ID, failing);
      result.current.keepalive.markComplete(ID);
    });

    broken = true;
    act(() => {
      result.current.keepalive.acquire("next", other);
    });

    expect(failing.destroy).toHaveBeenCalledOnce();
    expect(result.current.keepalive.has("next")).toBe(true);
    other.destroy();
  });
});
