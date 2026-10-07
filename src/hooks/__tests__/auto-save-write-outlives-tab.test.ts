// §3.5 쓰기가 끝나기 전에 탭이 닫히고 같은 파일이 새 탭으로 다시 열리면, 늦게 끝난 자동 저장은 새
// 탭의 기록을 덮지 않는다 (#798).
//
// 저장은 쓰기 뒤에 원문 · 수정 시각 · dirty 표시를 갱신한다. 그 사이 탭이 닫혔다면 그 갱신은 닫힌
// 파일의 원문을 되살리고, 같은 파일을 다시 연 탭이 있으면 그 탭이 읽은 내용을 옛 내용으로 덮는다.
import { act, renderHook } from "@testing-library/react";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { Editor } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let finishWrite: () => void = () => undefined;
const writeFile = vi.fn(
  (_path: string, _content: string) =>
    new Promise<void>((resolve) => {
      finishWrite = resolve;
    }),
);

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

/** 탭 t 를 닫고, 같은 파일을 새 탭 t2 로 다시 연다(디스크에서 읽은 내용으로). */
function closeAndReopen(path: string) {
  act(() => {
    useEditorStore.setState({ activeTabId: null, tabs: [] });
    useFileStore.getState().setFileContent(path, "reopened from disk");
    useEditorStore.setState({
      activeTabId: "t2",
      tabs: [tab("t2", path, false)],
    });
  });
}

async function finish() {
  await act(async () => {
    finishWrite();
    await Promise.resolve();
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

// 이것을 실패시키는 것: use-code-auto-save.ts 의 `stillShown` 관문을 지우면 늦게 끝난 저장이 다시 연
// 탭의 원문을 옛 내용으로 덮고 수정 시각을 남긴다.
describe("code auto-save that finishes after its tab closed", () => {
  it("leaves the reopened tab's content and mtime alone", async () => {
    useEditorStore.setState({
      activeTabId: "t",
      sourceEditedTabs: [],
      sourceModeTabs: [],
      tabs: [tab("t", "/v/note.txt")],
    } as never);
    const h = renderHook(() =>
      useCodeAutoSave({
        bufferVersion: 1,
        getSourceBuffer: () => "old save",
        isEditableTextFile: true,
        markDirty: () => undefined,
        sourceModeTabs: new Set(),
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(writeFile).toHaveBeenCalledTimes(1);

    closeAndReopen("/v/note.txt");
    await finish();

    expect(useFileStore.getState().openFiles.get("/v/note.txt")).toBe(
      "reopened from disk",
    );
    expect(useFileStore.getState().fileMtimes.has("/v/note.txt")).toBe(false);
    h.unmount();
  });

  it("records the save when the tab is still there", async () => {
    // 긍정 짝 — 같은 저장이 탭이 남아 있으면 원문과 수정 시각을 갱신한다.
    useEditorStore.setState({
      activeTabId: "t",
      sourceEditedTabs: [],
      sourceModeTabs: [],
      tabs: [tab("t", "/v/note.txt")],
    } as never);
    const h = renderHook(() =>
      useCodeAutoSave({
        bufferVersion: 1,
        getSourceBuffer: () => "saved",
        isEditableTextFile: true,
        markDirty: () => undefined,
        sourceModeTabs: new Set(),
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    await finish();

    expect(useFileStore.getState().openFiles.get("/v/note.txt")).toBe("saved");
    expect(useFileStore.getState().fileMtimes.has("/v/note.txt")).toBe(true);
    h.unmount();
  });
});

// 이것을 실패시키는 것: use-auto-save.ts 의 `stillShown` 관문을 지우면 같은 일이 마크다운 저장에서 일어난다.
describe("markdown auto-save that finishes after its tab closed", () => {
  it("leaves the reopened tab's content and mtime alone", async () => {
    const editor = new Editor({
      content: "<p>hello</p>",
      extensions: [Document, Paragraph, Text],
    });
    useEditorStore.setState({
      activeTabId: "t",
      sourceEditedTabs: [],
      sourceModeTabs: [],
      tabs: [tab("t", "/v/note.md", false)],
    } as never);
    updateOriginalDoc("t", editor.state.doc);
    const h = renderHook(() => useAutoSave(editor));
    act(() => {
      editor.commands.insertContentAt(1, "edited ");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(writeFile).toHaveBeenCalledTimes(1);

    closeAndReopen("/v/note.md");
    await finish();

    expect(useFileStore.getState().openFiles.get("/v/note.md")).toBe(
      "reopened from disk",
    );
    expect(useFileStore.getState().fileMtimes.has("/v/note.md")).toBe(false);
    h.unmount();
    editor.destroy();
  });
});
