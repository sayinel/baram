// §3.5 자동 저장은 예약할 때가 아니라 쓸 때의 탭 경로에 쓴다 (#798).
//
// debounce 를 기다리는 사이 파일을 rename · move 하면, 예약할 때 잡은 경로에 쓰는 것은 옛 파일을
// 다시 만드는 것이다(note.txt 가 되살아난다). 두 자동 저장 — 소스 버퍼의 use-code-auto-save 와
// WYSIWYG 문서의 use-auto-save — 모두 같다.
import { act, renderHook } from "@testing-library/react";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { Editor } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writeFile = vi.fn(async (_path: string, _content: string) => {});

vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  updateFileIndex: vi.fn(async () => undefined),
  writeFile: (path: string, content: string) => writeFile(path, content),
}));

import { Paragraph } from "../../extensions/nodes/paragraph";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { updateOriginalDoc } from "../../utils/editor/programmatic-update";
import { useAutoSave } from "../use-auto-save";
import { useCodeAutoSave } from "../use-code-auto-save";

function rename(from: string, to: string) {
  act(() => {
    useEditorStore.getState().renameTab(from, to, to.split("/").pop()!);
  });
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

async function waitOutDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  writeFile.mockClear();
  useSettingsStore.setState({ autoSave: true, autoSaveDelay: 500 } as never);
  useFileStore.setState({ fileMtimes: new Map(), openFiles: new Map() });
});

afterEach(() => {
  vi.useRealTimers();
});

// 이것을 실패시키는 것: use-code-auto-save.ts 의 timer 에서 `live.filePath` 대신 걸 때의
// `tab.filePath` 에 쓰면 첫 시험이, 새 경로로 writer 를 다시 판정하는 `isEditableTextPath(path)` ·
// `sourceMarkdown` 관문을 지우면 둘째 시험이 깨진다.
describe("code auto-save after a rename during the debounce", () => {
  function mount() {
    useEditorStore.setState({
      activeTabId: "t",
      sourceEditedTabs: [],
      sourceModeTabs: [],
      tabs: [tab("t", "/v/note.txt")],
    } as never);
    return renderHook(() =>
      useCodeAutoSave({
        bufferVersion: 1,
        getSourceBuffer: () => "typed",
        isEditableTextFile: true,
        markDirty: () => undefined,
        sourceModeTabs: new Set(),
      }),
    );
  }

  it("writes the file under its new name, not the old one", async () => {
    const h = mount();
    rename("/v/note.txt", "/v/renamed.txt");
    await waitOutDebounce();

    expect(writeFile).toHaveBeenCalledExactlyOnceWith(
      "/v/renamed.txt",
      "typed",
    );
    expect(useFileStore.getState().openFiles.has("/v/note.txt")).toBe(false);
    h.unmount();
  });

  it("does not write when the new name belongs to another writer", async () => {
    // .md 이고 소스 모드가 아니면 WYSIWYG 문서가 이 파일의 주인이다.
    const h = mount();
    rename("/v/note.txt", "/v/note.md");
    await waitOutDebounce();

    expect(writeFile).not.toHaveBeenCalled();
    h.unmount();
  });
});

// 이것을 실패시키는 것: use-auto-save.ts 의 save() 가 지금의 탭 대신 `pending.filePath` 에 쓰게
// 되돌리면 옛 경로에 쓴다.
describe("markdown auto-save after a rename during the debounce", () => {
  it("writes the document under its new name", async () => {
    const editor = new Editor({
      content: "<p>hello</p>",
      extensions: [Document, Paragraph, Text],
    });
    useEditorStore.setState({
      activeTabId: "m",
      sourceEditedTabs: [],
      sourceModeTabs: [],
      tabs: [tab("m", "/v/note.md", false)],
    } as never);
    updateOriginalDoc("m", editor.state.doc);
    const h = renderHook(() => useAutoSave(editor));

    act(() => {
      editor.commands.insertContentAt(1, "edited ");
    });
    rename("/v/note.md", "/v/renamed.md");
    await waitOutDebounce();

    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile.mock.calls[0][0]).toBe("/v/renamed.md");
    h.unmount();
    editor.destroy();
  });
});
