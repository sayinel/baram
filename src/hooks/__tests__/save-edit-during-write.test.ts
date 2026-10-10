// §3.5 쓰기를 기다리는 사이 사용자가 더 고치면, 그 쓰기는 탭을 "저장됨" 으로 만들지 않는다 (#798).
//
// 저장은 직렬화 → 쓰기 대기 → 기록(원문 캐시 · dirty · dirty 기준 문서)이다. 대기 중에 친 글자는 파일에
// 없으므로, 그 뒤에 "저장됨" 을 기록하면 닫기가 확인 없이 그 글자를 버린다. 저장을 하는 자리마다 쓰기를
// 손으로 끝내는 promise 로 바꿔 "쓰기 시작 → 편집 → 쓰기 끝" 을 만든다. 저장 자리는
// `grep -rn "markDirty([^,]*, false)\|updateOriginalDoc(\|markSourceEdited([^,]*, false)\|isDirty: false" src`
// 로 찾은 것 가운데 사용자의 내용을 쓰고 깨끗하다고 기록하는 여덟 곳이다.
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
import { updateOriginalDoc } from "../../utils/editor/programmatic-update";
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

function setTabs(...tabs: ReturnType<typeof tab>[]) {
  useEditorStore.setState({
    activeTabId: tabs[0]?.id ?? null,
    sourceEditedTabs: [],
    sourceModeTabs: [],
    tabs,
  } as never);
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
});

// 이것을 실패시키는 것: use-auto-save.ts 의 `editorStillHolds(...)` 조건을 지우면 첫 시험이,
// save-still-current.ts 의 직렬화 비교(`serializeLiveDoc(editor) === written`)를 지우면 둘째가,
// 활성 탭 확인을 지우면 셋째가 깨진다.
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
    expect(useFileStore.getState().openFiles.has("/v/note.md")).toBe(false);

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

  it("does not record a save after the editor moved on to another tab", async () => {
    const ed = makeEditor();
    const h = await editThenWaitForWrite(ed);
    act(() => {
      useEditorStore.setState((s) => ({
        activeTabId: "other",
        tabs: [...s.tabs, tab("other", "/v/other.md", false)],
      }));
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
    expect(useFileStore.getState().openFiles.has("/v/note.txt")).toBe(false);
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
  });
});

// 이것을 실패시키는 것: use-preview-source-view.ts 의 `getSourceBuffer(tab.id) !== content` 조기 반환을
// 지우면 깨진다.
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
  });
});
