// §82 실앱 보고: "소스 모드에서는 자동 저장도 안 먹힌다".
//
// ‼️ 마크다운 소스 모드에는 자동 저장이 **아예 없었다**. `use-auto-save`는 Tiptap의
// `update` 트랜잭션으로만 도는데 소스 모드에서는 그 편집기가 갱신되지 않고,
// 이 훅은 `isEditableTextFile`(=비마크다운)만 봤다. 그 사이에 마크다운 소스 편집이 떨어졌다.
// 예전에는 dirty 표시조차 없어 눈에 안 띄었을 뿐, 글이 저장되지 않는 것은 같았다.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const writeFile = vi.fn(async (_path: string, _content: string) => {});

vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  updateFileIndex: vi.fn(async () => undefined),
  writeFile: (path: string, content: string) => writeFile(path, content),
}));

import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useCodeAutoSave } from "../use-code-auto-save";

const PATH = "/v/note.md";
const TAB = "t1";
const BUFFER = "typed in source mode\n";

function mount(over: Partial<Parameters<typeof useCodeAutoSave>[0]> = {}) {
  return renderHook(() =>
    useCodeAutoSave({
      bufferVersion: 1,
      getSourceBuffer: () => BUFFER,
      isEditableTextFile: false,
      markDirty: (id, dirty) => useEditorStore.getState().markDirty(id, dirty),
      sourceModeTabs: new Set([TAB]),
      ...over,
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  writeFile.mockClear();
  useSettingsStore.setState({ autoSave: true, autoSaveDelay: 500 } as never);
  useFileStore.setState({ fileMtimes: new Map(), openFiles: new Map() });
  useEditorStore.setState({
    activeTabId: TAB,
    mruOrder: [],
    sourceEditedTabs: [TAB],
    sourceModeTabs: [TAB],
    tabs: [
      {
        contextId: "c",
        filePath: PATH,
        id: TAB,
        isDirty: false,
        isPinned: false,
        title: "note.md",
        type: "file",
      },
    ],
  } as never);
});

describe("auto-save for markdown edited in source mode", () => {
  it("writes the buffer after the delay and clears the source-edited flag", async () => {
    const h = mount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(writeFile).toHaveBeenCalledWith(PATH, BUFFER);
    expect(useEditorStore.getState().sourceEditedTabs).toEqual([]);
    h.unmount();
  });

  it("does nothing for a markdown tab that is NOT in source mode", async () => {
    // ‼️ 이 탭은 **dirty여야 한다.** 깨끗한 탭은 어느 구현에서도 안 쓰이므로, 그런
    // 픽스처로는 "소스 모드가 아닐 때 쓰지 않는다"를 고정할 수 없다 — 관문을 지워도
    // 테스트가 통과한다(실제로 그 뮤테이션이 살아남았다).
    useEditorStore.setState({
      sourceEditedTabs: [],
      sourceModeTabs: [],
      tabs: [{ ...useEditorStore.getState().tabs[0], isDirty: true }],
    });
    const h = mount({ sourceModeTabs: new Set() });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    // The WYSIWYG surface owns that tab; `use-auto-save` writes it from the
    // Tiptap document. Two writers for one tab is how content gets clobbered.
    expect(writeFile).not.toHaveBeenCalled();
    h.unmount();
  });

  it("respects the autoSave setting", async () => {
    useSettingsStore.setState({ autoSave: false } as never);
    const h = mount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(writeFile).not.toHaveBeenCalled();
    h.unmount();
  });
});
