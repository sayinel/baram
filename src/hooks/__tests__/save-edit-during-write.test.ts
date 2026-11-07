// §3.5 쓰기를 기다리는 사이 사용자가 더 고치면, 그 쓰기는 탭을 "저장됨" 으로 만들지 않는다 (#798).
//
// 저장은 직렬화 → 쓰기 대기 → 기록(원문 캐시 · dirty · dirty 기준 문서)이다. 대기 중에 친 글자는 파일에
// 없으므로, 그 뒤에 "저장됨" 을 기록하면 닫기가 확인 없이 그 글자를 버린다. 저장을 하는 자리마다 쓰기를
// 손으로 끝내는 promise 로 바꿔 "쓰기 시작 → 편집 → 쓰기 끝" 을 만든다. 저장 자리는
// `grep -rn "markDirty([^,]*, false)\|updateOriginalDoc(\|markSourceEdited([^,]*, false)\|isDirty: false" src`
// 로 찾은 것 가운데 사용자의 내용을 쓰고 깨끗하다고 기록하는 여덟 곳이다. 같은 grep 이 찾는 아홉째 자리, 소스
// 모드에서 돌아올 때의 저장(`use-source-mode.ts` 의 `handBufferToDocument`)은 `auto-save-crossing-source-mode.test.ts`
// 가 같은 규칙으로 시험한다.
import type { EditorState } from "@tiptap/pm/state";

import { act, renderHook } from "@testing-library/react";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { Editor } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writes: { content: string; finish: () => void; path: string }[] = [];
const writeFile = vi.fn(
  (path: string, content: string) =>
    new Promise<void>((resolve) => {
      writes.push({ content, finish: resolve, path });
    }),
);

vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  updateFileIndex: vi.fn(async () => undefined),
  writeFile: (path: string, content: string) => writeFile(path, content),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(async () => "/v/chosen.md"),
}));
vi.mock("../../plugins/plugin-lifecycle", () => ({
  notifyFileOpen: vi.fn(),
  notifyFileSave: vi.fn(),
}));

import { Paragraph } from "../../extensions/nodes/paragraph";
import { isTabUnsaved, useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import {
  markContentLoaded,
  updateOriginalDoc,
} from "../../utils/editor/programmatic-update";
import { useAutoSave } from "../use-auto-save";
import { saveDirtyTab } from "../use-close-guard";
import { useCodeAutoSave } from "../use-code-auto-save";
import { useFileOperations } from "../use-file-operations";
import { usePreviewSourceView } from "../use-preview-source-view";

let editor: Editor | null = null;

function dirty(id: string): boolean {
  const s = useEditorStore.getState();
  return isTabUnsaved(
    s.tabs.find((t) => t.id === id),
    s.sourceEditedTabs,
  );
}

async function finishWrite(i: number) {
  await act(async () => {
    writes[i].finish();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function makeEditor(html = "<p>hello</p>") {
  editor = new Editor({
    content: html,
    extensions: [Document, Paragraph, Text],
  });
  return editor;
}

/** Another editor, destroyed by its test — the shared editor beside a keep-alive one. */
function makeSecondEditor() {
  return new Editor({
    content: "<p>other</p>",
    extensions: [Document, Paragraph, Text],
  });
}

function setTabs(...tabs: ReturnType<typeof tab>[]) {
  useEditorStore.setState({
    activeTabId: tabs[0]?.id ?? null,
    sourceEditedTabs: [],
    sourceModeTabs: [],
    tabs,
  } as never);
  // The editor holds the active tab's document, as after the app installs it — main's saves skip a
  // tab the editor does not hold (`editorHoldsWholeDocument`).
  if (tabs[0]) markContentLoaded(tabs[0].id);
}

function tab(id: string, filePath: string, isDirty = true) {
  return {
    contextId: "c",
    filePath,
    id,
    isDirty,
    isPinned: false,
    title: id,
    type: "file" as const,
  };
}

beforeEach(() => {
  writes.length = 0;
  writeFile.mockClear();
  useSettingsStore.setState({ autoSave: true, autoSaveDelay: 500 } as never);
  useFileStore.setState({ fileMtimes: new Map(), openFiles: new Map() });
});

afterEach(() => {
  vi.useRealTimers();
  editor?.destroy();
  editor = null;
  useEditorStore.getState().registerDocumentSurfaceAccess(null);
});

// 이것을 실패시키는 것: use-auto-save.ts 의 `unchanged` 조건을 지우면 첫 시험이, save-still-current.ts 의
// `held.doc.eq(docAtWrite)` 를 지우면(같은 객체만 같다고 보면) 둘째가 깨진다. 캐시를 `unchanged` 일 때만
// 쓰게 되돌리면 첫 시험의 캐시 단정이 깨진다.
describe("markdown auto-save", () => {
  async function editThenWaitForWrite(ed: Editor) {
    vi.useFakeTimers();
    setTabs(tab("m", "/v/note.md", false));
    updateOriginalDoc("m", ed.state.doc);
    const h = renderHook(() => useAutoSave(ed));
    act(() => {
      ed.commands.insertContentAt(1, "first ");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(writes).toHaveLength(1);
    return h;
  }

  it("keeps the tab dirty when the user typed while the write ran, and the next save writes the newer text", async () => {
    const ed = makeEditor();
    const h = await editThenWaitForWrite(ed);
    act(() => {
      ed.commands.insertContentAt(1, "second ");
    });
    await finishWrite(0);

    expect(dirty("m")).toBe(true);
    // The editor still holds the tab, so the cache is the file on disk — what the first write put
    // there, not the newer document — and the conflict modal's 3-way base stays right.
    expect(useFileStore.getState().openFiles.get("/v/note.md")).toBe(
      writes[0].content,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(writes).toHaveLength(2);
    expect(writes[1].content).toContain("second first hello");
    await finishWrite(1);
    expect(dirty("m")).toBe(false);
    h.unmount();
  });

  it("counts an edit undone before the write ended as unchanged", async () => {
    const ed = makeEditor();
    const h = await editThenWaitForWrite(ed);
    act(() => {
      ed.commands.insertContentAt(1, "x");
      ed.commands.deleteRange({ from: 1, to: 2 });
    });
    await finishWrite(0);

    expect(dirty("m")).toBe(false);
    h.unmount();
  });
});

// §3.5 A tab left while its write ran: "still holds" is asked of where its document is now, not of
// whether it is the active tab (#798). The switch is played as the app does it — the next tab is
// installed in the shared editor (`markContentLoaded`) and the left tab's state goes to the
// tab-switch cache, its text to `openFiles` (`saveOutgoingTab`); a keep-alive editor keeps its own
// document.
// 이것을 실패시키는 것: save-still-current.ts 의 `heldDocument` 를 활성 탭 확인
// (`activeTabId !== tabId` 면 null)으로 되돌리면 첫째와 셋째가, 캐시에서 읽은 문서를 `live: true` 로
// 돌려주면 둘째의 캐시 단정이 깨진다.
describe("markdown auto-save of a tab left during the write", () => {
  async function writeThen(ed: Editor) {
    vi.useFakeTimers();
    setTabs(tab("m", "/v/note.md", false), tab("other", "/v/other.md", false));
    updateOriginalDoc("m", ed.state.doc);
    const h = renderHook(() => useAutoSave(ed));
    act(() => {
      ed.commands.insertContentAt(1, "first ");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(writes).toHaveLength(1);
    return h;
  }

  function switchToOther(cache: Map<string, EditorState>, ed: Editor) {
    cache.set("m", ed.state);
    useFileStore.getState().setFileContent("/v/note.md", "text on the way out");
    useEditorStore.setState({ activeTabId: "other" });
    markContentLoaded("other");
  }

  it("records the save when the cached document is what was written", async () => {
    const ed = makeEditor();
    const cache = new Map<string, EditorState>();
    useEditorStore.getState().registerDocumentSurfaceAccess({
      editor: ed,
      editorStateCache: cache,
      isKeepaliveComplete: () => true,
      keepaliveEditor: () => null,
    });
    const h = await writeThen(ed);
    act(() => switchToOther(cache, ed));
    await finishWrite(0);

    expect(dirty("m")).toBe(false);
    h.unmount();
  });

  it("keeps the tab unsaved, and its text in the cache, when it was edited before it was left", async () => {
    const ed = makeEditor();
    const cache = new Map<string, EditorState>();
    useEditorStore.getState().registerDocumentSurfaceAccess({
      editor: ed,
      editorStateCache: cache,
      isKeepaliveComplete: () => true,
      keepaliveEditor: () => null,
    });
    const h = await writeThen(ed);
    act(() => {
      ed.commands.insertContentAt(1, "second ");
      switchToOther(cache, ed);
    });
    await finishWrite(0);

    expect(dirty("m")).toBe(true);
    // The close guard's background save writes this entry; the older written text must not
    // replace it.
    expect(useFileStore.getState().openFiles.get("/v/note.md")).toBe(
      "text on the way out",
    );
    h.unmount();
  });

  it("records the save of a keep-alive tab, whose editor keeps its document in the background", async () => {
    const ed = makeEditor();
    const shared = makeSecondEditor();
    useEditorStore.getState().registerDocumentSurfaceAccess({
      editor: shared,
      editorStateCache: new Map(),
      isKeepaliveComplete: () => true,
      keepaliveEditor: (id) => (id === "m" ? ed : null),
    });
    const h = await writeThen(ed);
    act(() => {
      useEditorStore.setState({ activeTabId: "other" });
      markContentLoaded("other");
    });
    await finishWrite(0);

    expect(dirty("m")).toBe(false);
    expect(useFileStore.getState().openFiles.get("/v/note.md")).toBe(
      writes[0].content,
    );
    h.unmount();
    shared.destroy();
  });

  it("does not record a save once nothing holds the document", async () => {
    const ed = makeEditor();
    const h = await writeThen(ed);
    act(() => {
      useEditorStore.setState({ activeTabId: "other" });
      markContentLoaded("other");
    });
    await finishWrite(0);

    expect(dirty("m")).toBe(true);
    h.unmount();
  });
});

// 이것을 실패시키는 것: use-code-auto-save.ts 의 `getSourceBuffer(tab.id) === content` 조건을 지우면 깨진다.
describe("source buffer auto-save", () => {
  it("keeps the tab dirty when the buffer changed while the write ran", async () => {
    vi.useFakeTimers();
    setTabs(tab("t", "/v/note.txt"));
    let buffer = "first";
    const h = renderHook(() =>
      useCodeAutoSave({
        bufferVersion: 1,
        getSourceBuffer: () => buffer,
        isEditableTextFile: true,
        markDirty: (id, d) => useEditorStore.getState().markDirty(id, d),
        sourceModeTabs: new Set(),
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    buffer = "first and more";
    await finishWrite(0);

    expect(dirty("t")).toBe(true);
    // Still the active tab, so the cache is the file on disk.
    expect(useFileStore.getState().openFiles.get("/v/note.txt")).toBe("first");
    h.unmount();
  });

  // 이것을 실패시키는 것: save-still-current.ts 의 `bufferSaveOutcome` 에서 활성 탭 확인을 빼고 캐시를 늘
  // 쓰면, 떠날 때 버퍼를 옮겨 둔 캐시를 옛 글로 덮는다.
  it("leaves the cache alone for a tab left during the write, which holds its newer text", async () => {
    vi.useFakeTimers();
    setTabs(tab("t", "/v/note.txt"), tab("other", "/v/other.md", false));
    let buffer = "first";
    const h = renderHook(() =>
      useCodeAutoSave({
        bufferVersion: 1,
        getSourceBuffer: () => buffer,
        isEditableTextFile: true,
        markDirty: (id, d) => useEditorStore.getState().markDirty(id, d),
        sourceModeTabs: new Set(),
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    buffer = "first and more";
    // `saveOutgoingTab` copies a code tab's buffer into `openFiles` on the way out.
    useFileStore.getState().setFileContent("/v/note.txt", buffer);
    useEditorStore.setState({ activeTabId: "other" });
    await finishWrite(0);

    expect(dirty("t")).toBe(true);
    expect(useFileStore.getState().openFiles.get("/v/note.txt")).toBe(
      "first and more",
    );
    h.unmount();
  });
});

// 이것을 실패시키는 것: use-file-operations.ts 의 `stillHolds()` 조건을 지우면 첫 시험이, 제목 없는 탭
// 갈래의 `clean ? false : t.isDirty` 를 `false` 로 되돌리면 둘째가, handleSaveAs 의 `if (clean)` 을
// 지우면 셋째가 깨진다.
describe("Cmd+S and Save As", () => {
  function ops(ed: Editor) {
    return renderHook(() =>
      useFileOperations({
        editor: ed,
        getSourceBuffer: () => "",
        sourceModeTabs: new Set(),
      }),
    );
  }

  async function saveWhileTyping(
    ed: Editor,
    run: (h: ReturnType<typeof ops>) => Promise<void>,
  ) {
    const h = ops(ed);
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = run(h);
    });
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(writes).toHaveLength(1);
    act(() => {
      ed.commands.insertContentAt(1, "late ");
    });
    await finishWrite(0);
    await act(async () => {
      await done;
    });
  }

  it("Cmd+S leaves a file tab dirty when the document changed during the write", async () => {
    const ed = makeEditor();
    setTabs(tab("m", "/v/note.md"));
    await saveWhileTyping(ed, (h) => h.result.current.handleSave());

    expect(dirty("m")).toBe(true);
  });

  it("Cmd+S on an untitled tab names it but leaves it dirty", async () => {
    const ed = makeEditor();
    setTabs(tab("u", ""));
    await saveWhileTyping(ed, (h) => h.result.current.handleSave());

    const after = useEditorStore.getState().tabs[0];
    expect(after.filePath).toBe("/v/chosen.md");
    expect(after.isDirty).toBe(true);
  });

  // 이것을 실패시키는 것: 제목 없는 탭 갈래의 `if (clean)` 을 빼고 markSourceEdited 를 늘 부르면 소스
  // 모드에서 고친 글이 "저장 안 됨" 표시를 잃는다.
  it("Cmd+S on an untitled source-mode tab keeps its unsaved-source mark", async () => {
    const ed = makeEditor();
    useEditorStore.setState({
      activeTabId: "u",
      sourceEditedTabs: ["u"],
      sourceModeTabs: ["u"],
      tabs: [tab("u", "", false)],
    } as never);
    let buffer = "typed in source";
    const h = renderHook(() =>
      useFileOperations({
        editor: ed,
        getSourceBuffer: () => buffer,
        sourceModeTabs: new Set(["u"]),
      }),
    );
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = h.result.current.handleSave();
    });
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    buffer = "typed in source, and more";
    await finishWrite(0);
    await act(async () => {
      await done;
    });

    expect(useEditorStore.getState().sourceEditedTabs).toEqual(["u"]);
  });

  // §3.5 (#798) 이것을 실패시키는 것: handleSave 의 `tabStillShows` 관문을 빼면 옛 경로에 원문 · 수정 시각이
  // 다시 생기고, 탭이 옛 경로에서 깨끗하다고 기록된다.
  it("Cmd+S records nothing under a path the tab was renamed away from during the write", async () => {
    const ed = makeEditor();
    setTabs(tab("m", "/v/note.md"));
    const h = ops(ed);
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = h.result.current.handleSave();
    });
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(writes).toHaveLength(1);
    act(() => {
      useEditorStore
        .getState()
        .renameTab("/v/note.md", "/v/renamed.md", "renamed.md");
    });
    await finishWrite(0);
    await act(async () => {
      await done;
    });

    expect(useFileStore.getState().openFiles.has("/v/note.md")).toBe(false);
    expect(useFileStore.getState().fileMtimes.has("/v/note.md")).toBe(false);
    expect(dirty("m")).toBe(true);
  });

  // §3.5 (#798) Save As leaves the old file on disk with no tab showing it, and the tab keeps its id,
  // so the closed-tab release never sees the old path go.
  // 이것을 실패시키는 것: handleSaveAs 의 `releaseFileContents([oldKey])` 를 빼면 옛 경로의 원문과 수정 시각이
  // 남아, watcher 가 그 파일을 아직 열려 있다고 본다.
  it("Save As of a file tab releases the path it left", async () => {
    const ed = makeEditor();
    setTabs(tab("m", "/v/note.md", false));
    useFileStore.getState().setFileContent("/v/note.md", "hello\n");
    useFileStore.getState().updateLastSaveMtime("/v/note.md", 1);
    const h = ops(ed);
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = h.result.current.handleSaveAs();
    });
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    await finishWrite(0);
    await act(async () => {
      await done;
    });

    const files = useFileStore.getState();
    expect(files.openFiles.has("/v/note.md")).toBe(false);
    expect(files.fileMtimes.has("/v/note.md")).toBe(false);
    expect(files.openFiles.get("/v/chosen.md")).toBe(writes[0].content);
    expect(useEditorStore.getState().tabs[0].filePath).toBe("/v/chosen.md");
  });

  async function startThen(
    ed: Editor,
    run: (h: ReturnType<typeof ops>) => Promise<void>,
    during: () => void,
  ) {
    const h = ops(ed);
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = run(h);
    });
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(writes).toHaveLength(1);
    act(during);
    await finishWrite(0);
    await act(async () => {
      await done;
    });
  }

  function leaveFor(other: string, ed: Editor, key: string) {
    const cache = new Map<string, EditorState>();
    useEditorStore.getState().registerDocumentSurfaceAccess({
      editor: ed,
      editorStateCache: cache,
      isKeepaliveComplete: () => true,
      keepaliveEditor: () => null,
    });
    return () => {
      const { activeTabId } = useEditorStore.getState();
      ed.commands.insertContentAt(1, "late ");
      cache.set(activeTabId!, ed.state);
      useFileStore.getState().setFileContent(key, "text on the way out");
      useEditorStore.setState({ activeTabId: other });
      markContentLoaded(other);
    };
  }

  // §3.5 (#798) 문서를 쓴 저장은 소스 모드의 표시를 내리지 않는다. 쓰는 사이 소스 모드로 들어가 친 글은 버퍼에만
  // 있고, 문서가 그대로라는 답은 그 글에 대해 아무것도 말하지 않는다.
  // 이것을 실패시키는 것: handleSave 의 파일 갈래에서 `if (fromBuffer)` 를 빼고 표시를 늘 내리면 깨진다.
  it("Cmd+S of the document keeps the source mark of text typed in source mode during the write", async () => {
    const ed = makeEditor();
    setTabs(tab("m", "/v/note.md", false));
    await startThen(
      ed,
      (h) => h.result.current.handleSave(),
      () => {
        useEditorStore.setState({ sourceModeTabs: ["m"] });
        useEditorStore.getState().markSourceEdited("m", true);
      },
    );

    expect(useEditorStore.getState().sourceEditedTabs).toEqual(["m"]);
  });

  // 이것을 실패시키는 것: handleSave 의 제목 없는 갈래에서 `clean && fromBuffer` 를 `clean` 으로 되돌리면 깨진다.
  it("Cmd+S of an untitled tab's document keeps the source mark of text typed in source mode during the write", async () => {
    const ed = makeEditor();
    setTabs(tab("u", "", false), tab("a", "/v/a.md", false));
    await startThen(
      ed,
      (h) => h.result.current.handleSave(),
      () => {
        useEditorStore.setState({ sourceModeTabs: ["u"] });
        useEditorStore.getState().markSourceEdited("u", true);
      },
    );

    expect(useEditorStore.getState().tabs[0].filePath).toBe("/v/chosen.md");
    expect(useEditorStore.getState().sourceEditedTabs).toEqual(["u"]);
  });

  // 이것을 실패시키는 것: handleSave 의 제목 없는 갈래에서 `tabStillShows(saveTab.id, "")` 관문을 빼면 닫힌
  // 탭을 위해 새 파일의 수정 시각과 원문이 생긴다.
  it("Cmd+S on an untitled tab closed during the write records nothing for the new file", async () => {
    const ed = makeEditor();
    setTabs(tab("u", ""), tab("a", "/v/a.md", false));
    await startThen(
      ed,
      (h) => h.result.current.handleSave(),
      () => useEditorStore.getState().closeTab("u"),
    );

    expect(useFileStore.getState().fileMtimes.has("/v/chosen.md")).toBe(false);
    expect(useFileStore.getState().openFiles.has("/v/chosen.md")).toBe(false);
  });

  // 이것을 실패시키는 것: handleSaveAs 의 `tabStillShows(saveAsTab.id, …)` 관문을 빼면 닫힌 탭을 위해 사본의
  // 수정 시각과 원문이 생긴다.
  it("Save As of a tab closed during the write records nothing for the copy", async () => {
    const ed = makeEditor();
    setTabs(tab("m", "/v/note.md"), tab("a", "/v/a.md", false));
    await startThen(
      ed,
      (h) => h.result.current.handleSaveAs(),
      () => useEditorStore.getState().closeTab("m"),
    );

    expect(useFileStore.getState().fileMtimes.has("/v/chosen.md")).toBe(false);
    expect(useFileStore.getState().openFiles.has("/v/chosen.md")).toBe(false);
  });

  // §3.5 A tab left while the write ran had its newer text copied into its entry on the way out; the
  // entry moves to the new path as it is (`SaveOutcome.cacheIsDisk`).
  // 이것을 실패시키는 것: handleSave 의 제목 없는 갈래에서 `setFileContent(savePath, md)` 로 옮기면 그 글을
  // 옛 글로 바꾼다.
  it("Cmd+S on an untitled tab left during the write moves its newer text to the new path", async () => {
    const ed = makeEditor();
    setTabs(tab("u", ""), tab("other", "/v/other.md", false));
    await startThen(
      ed,
      (h) => h.result.current.handleSave(),
      leaveFor("other", ed, "u"),
    );

    expect(useFileStore.getState().openFiles.get("/v/chosen.md")).toBe(
      "text on the way out",
    );
    expect(dirty("u")).toBe(true);
  });

  // 이것을 실패시키는 것: handleSaveAs 에서 `setFileContent(savePath, md)` 로 옮기면 그 글을 옛 글로 바꾼다.
  it("Save As of a tab left during the write moves its newer text to the new path", async () => {
    const ed = makeEditor();
    setTabs(tab("m", "/v/note.md"), tab("other", "/v/other.md", false));
    await startThen(
      ed,
      (h) => h.result.current.handleSaveAs(),
      leaveFor("other", ed, "/v/note.md"),
    );

    expect(useFileStore.getState().openFiles.get("/v/chosen.md")).toBe(
      "text on the way out",
    );
    expect(useFileStore.getState().openFiles.has("/v/note.md")).toBe(false);
    expect(dirty("m")).toBe(true);
  });

  it("Save As leaves the tab dirty when the document changed during the write", async () => {
    const ed = makeEditor();
    setTabs(tab("m", "/v/note.md"));
    await saveWhileTyping(ed, (h) => h.result.current.handleSaveAs());

    expect(dirty("m")).toBe(true);
  });
});

// 이것을 실패시키는 것: use-close-guard.ts 의 saveDirtyTab 에서 `clean` 판정을 `true` 로 바꾸면 첫 시험이,
// saveUntitled 의 `clean` 을 `true` 로 바꾸면 둘째가 깨진다.
describe("saving a background tab before a close", () => {
  it("reports failure and keeps the tab dirty when its text changed during the write", async () => {
    setTabs(tab("a", "/v/a.md", false), tab("b", "/v/b.md"));
    useFileStore.getState().setFileContent("/v/b.md", "older");
    let ok: boolean | null = null;
    const saving = saveDirtyTab(
      useEditorStore.getState().tabs[1],
      "a",
      vi.fn(),
    ).then((r) => {
      ok = r;
    });
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    useFileStore.getState().setFileContent("/v/b.md", "newer");
    await finishWrite(0);
    await saving;

    expect(ok).toBe(false);
    expect(dirty("b")).toBe(true);
  });

  it("names an untitled background tab but keeps it dirty and open", async () => {
    setTabs(tab("a", "/v/a.md", false), tab("u", ""));
    useFileStore.getState().setFileContent("u", "older");
    let ok: boolean | null = null;
    const saving = saveDirtyTab(
      useEditorStore.getState().tabs[1],
      "a",
      vi.fn(),
    ).then((r) => {
      ok = r;
    });
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    useFileStore.getState().setFileContent("u", "newer");
    await finishWrite(0);
    await saving;

    expect(ok).toBe(false);
    const after = useEditorStore.getState().tabs[1];
    expect(after.filePath).toBe("/v/chosen.md");
    expect(after.isDirty).toBe(true);
    // The entry was where the tab's text lived, so the newer text moves with the tab.
    // 이것을 실패시키는 것: use-close-guard.ts 의 `carried` 대신 `content` 를 옮기면 "older" 가 된다.
    expect(useFileStore.getState().openFiles.get("/v/chosen.md")).toBe("newer");
    expect(useFileStore.getState().openFiles.has("u")).toBe(false);
  });

  // 이것을 실패시키는 것: use-close-guard.ts 의 파일 갈래에서 `tabStillShows` 관문을 빼면 옛 경로에 수정 시각이
  // 생기고, 저장이 성공으로 보고되어 닫기가 진행된다.
  it("reports failure for a background tab renamed during the write and records nothing under its old path", async () => {
    setTabs(tab("a", "/v/a.md", false), tab("b", "/v/b.md"));
    useFileStore.getState().setFileContent("/v/b.md", "text");
    let ok: boolean | null = null;
    const saving = saveDirtyTab(
      useEditorStore.getState().tabs[1],
      "a",
      vi.fn(),
    ).then((r) => {
      ok = r;
    });
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    act(() => {
      useEditorStore.getState().renameTab("/v/b.md", "/v/b2.md", "b2.md");
    });
    await finishWrite(0);
    await saving;

    expect(ok).toBe(false);
    expect(useFileStore.getState().fileMtimes.has("/v/b.md")).toBe(false);
  });

  // 이것을 실패시키는 것: use-close-guard.ts 의 제목 없는 갈래에서 `tabStillShows(tab.id, "")` 관문을 빼면 닫힌
  // 탭을 위해 새 파일의 수정 시각과 원문이 생긴다.
  it("records nothing for an untitled background tab closed during the write", async () => {
    setTabs(tab("a", "/v/a.md", false), tab("u", ""));
    useFileStore.getState().setFileContent("u", "text");
    let ok: boolean | null = null;
    const saving = saveDirtyTab(
      useEditorStore.getState().tabs[1],
      "a",
      vi.fn(),
    ).then((r) => {
      ok = r;
    });
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    act(() => {
      useEditorStore.getState().closeTab("u");
    });
    await finishWrite(0);
    await saving;

    expect(ok).toBe(false);
    expect(useFileStore.getState().fileMtimes.has("/v/chosen.md")).toBe(false);
    expect(useFileStore.getState().openFiles.has("/v/chosen.md")).toBe(false);
  });
});

// 이것을 실패시키는 것: use-preview-source-view.ts 의 `if (unchanged)` 를 빼면 dirty 단정이, `cacheIsDisk` 일 때
// 캐시를 쓰지 않으면 캐시 단정이 깨진다.
describe("leaving an HTML tab's source view", () => {
  it("keeps the tab dirty when the buffer changed during the flush", async () => {
    setTabs(tab("h", "/v/page.html"));
    // §392 the preview-to-source set lives in the editor store now.
    useEditorStore.setState({ previewSourceTabs: ["h"] });
    let buffer = "<p>first</p>";
    const { result } = renderHook(() =>
      usePreviewSourceView({
        getSourceBuffer: () => buffer,
        markDirty: (id, d) => useEditorStore.getState().markDirty(id, d),
        toggleSourceMode: () => undefined,
      }),
    );
    act(() => {
      result.current.toggleHtmlView();
    });
    buffer = "<p>first and more</p>";
    await finishWrite(0);

    expect(dirty("h")).toBe(true);
    // Still the active tab, so the cache is the file on disk.
    expect(useFileStore.getState().openFiles.get("/v/page.html")).toBe(
      "<p>first</p>",
    );
  });

  // 이것을 실패시키는 것: use-preview-source-view.ts 의 `tabStillShows` 관문을 빼면 닫힌 탭의 경로에 수정
  // 시각과 원문이 다시 생긴다.
  it("records nothing for a tab closed during the flush", async () => {
    setTabs(tab("h", "/v/page.html"), tab("a", "/v/a.md", false));
    useEditorStore.setState({ previewSourceTabs: ["h"] });
    const { result } = renderHook(() =>
      usePreviewSourceView({
        getSourceBuffer: () => "<p>first</p>",
        markDirty: (id, d) => useEditorStore.getState().markDirty(id, d),
        toggleSourceMode: () => undefined,
      }),
    );
    act(() => {
      result.current.toggleHtmlView();
    });
    act(() => {
      useEditorStore.getState().closeTab("h");
    });
    await finishWrite(0);

    expect(useFileStore.getState().fileMtimes.has("/v/page.html")).toBe(false);
    expect(useFileStore.getState().openFiles.has("/v/page.html")).toBe(false);
  });
});
