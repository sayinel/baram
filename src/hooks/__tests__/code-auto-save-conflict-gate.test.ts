/*
 * §3.6 소스·코드 자동 저장도 미해결 외부 변경을 덮지 않는다. 그리고 두 자동 저장 모두
 * 쓰는 순간의 경로에 쓴다.
 *
 * WYSIWYG 자동 저장에는 외부 변경 가드(`shouldDeferSave`)가 있었지만 소스 버퍼를 쓰는
 * `use-code-auto-save` 에는 없었다. 외부 변경이 걸린 소스 모드 탭은 디바운스가 끝나는 순간
 * 버퍼로 디스크를 덮었다 — 충돌 모달이 떠 있는 동안에도.
 *
 * 두 훅 모두 timer 를 세울 때의 경로를 들고 있다가 그 경로에 썼다. 디바운스 중 rename 이면
 * 옛 경로에 파일을 다시 만들고, 캐시·mtime 을 옛 키에 남긴다.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writeFile = vi.fn(async (_path: string, _content: string) => {});
const updateFileIndex = vi.fn(async (_path: string) => {});

vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  updateFileIndex: (path: string) => updateFileIndex(path),
  writeFile: (path: string, content: string) => writeFile(path, content),
}));

import { Editor } from "@tiptap/core";

import { createBaramExtensions } from "../../extensions";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useAutoSave } from "../use-auto-save";
import { useCodeAutoSave } from "../use-code-auto-save";

const MD = "/v/a.md";
const MD2 = "/v/a2.md";
const TS = "/v/x.ts";
const TAB = "t1";
const BUFFER = "typed in source mode\n";

const fileTab = (filePath: string, isDirty = false) => ({
  contextId: "c",
  filePath,
  id: TAB,
  isDirty,
  isPinned: false,
  title: filePath.split("/").pop()!,
  type: "file" as const,
});

function mountCode(
  over: Partial<Parameters<typeof useCodeAutoSave>[0]> = {},
): ReturnType<typeof renderHook<void, { bufferVersion: number }>> {
  return renderHook(
    ({ bufferVersion }: { bufferVersion: number }) =>
      useCodeAutoSave({
        bufferVersion,
        getSourceBuffer: () => BUFFER,
        isEditableTextFile: false,
        markDirty: (id, dirty) =>
          useEditorStore.getState().markDirty(id, dirty),
        sourceModeTabs: new Set([TAB]),
        ...over,
      }),
    { initialProps: { bufferVersion: 1 } },
  );
}

/** 미해결 외부 변경: `canReloadMtime > lastSaveMtime`. */
const pendingExternalChange = (path: string) => {
  useFileStore.getState().updateLastSaveMtime(path, 1000);
  useFileStore.getState().updateCanReloadMtime(path, 2000);
};

const rename = (from: string, to: string) => {
  useFileStore.getState().renameFileEntry(from, to, to.split("/").pop()!);
  useEditorStore.getState().renameTab(from, to, to.split("/").pop()!);
};

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(5000);
  writeFile.mockClear();
  updateFileIndex.mockClear();
  useSettingsStore.setState({ autoSave: true, autoSaveDelay: 500 } as never);
  useFileStore.setState({
    fileMtimes: new Map(),
    fileTree: [],
    openFiles: new Map([[MD, "opened\n"]]),
  });
  useEditorStore.setState({
    activeTabId: TAB,
    mruOrder: [],
    sourceEditedTabs: [TAB],
    sourceModeTabs: [TAB],
    tabs: [fileTab(MD)],
  } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("§3.6 source and code auto-save hold while an external change is pending", () => {
  it("a source-mode markdown tab is not written while the guard holds", async () => {
    // 이것을 실패시키는 것: timer 발화 시점의 `shouldDeferSave` 관문 제거.
    pendingExternalChange(MD);
    const h = mountCode();

    await advance(600);

    expect(writeFile).not.toHaveBeenCalled();
    expect(useEditorStore.getState().sourceEditedTabs).toEqual([TAB]);
    h.unmount();
  });

  it("a dirty code tab is not written while the guard holds", async () => {
    // 이것을 실패시키는 것: timer 발화 시점의 `shouldDeferSave` 관문 제거.
    useEditorStore.setState({
      sourceEditedTabs: [],
      tabs: [fileTab(TS, true)],
    });
    pendingExternalChange(TS);
    const h = mountCode({
      isEditableTextFile: true,
      sourceModeTabs: new Set(),
    });

    await advance(600);

    expect(writeFile).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
    h.unmount();
  });

  it("a deferred save is retried by the next edit, not by the acknowledgement", async () => {
    // 특성화(결정 고정): 가드가 풀리는 순간 다시 시도하지 않는다. 다음 편집이 timer 를
    // 다시 세운다. 이것을 실패시키는 것: 가드 해제 시 재시도를 더함(첫 단언이 깨진다).
    // 뒤의 긍정 단언은 같은 탭이 실제로 저장될 수 있음을 보여 앞 단언이 공허하지 않게 한다.
    pendingExternalChange(MD);
    const h = mountCode();
    await advance(600);
    expect(writeFile).not.toHaveBeenCalled();

    useFileStore.getState().updateCanReloadMtime(MD, 0);
    await advance(600);
    expect(writeFile).not.toHaveBeenCalled();

    h.rerender({ bufferVersion: 2 });
    await advance(600);
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith(MD, BUFFER);
    h.unmount();
  });

  it("a rename during the debounce carries the guard: nothing is written", async () => {
    // 이것을 실패시키는 것: timer 가 세울 때의 `tab.filePath` 로 가드를 봄(옛 경로의 가드는
    // 재키잉으로 비었으므로 옛 경로에 쓴다).
    pendingExternalChange(MD);
    const h = mountCode();

    rename(MD, MD2);
    await advance(600);

    expect(writeFile).not.toHaveBeenCalled();
    h.unmount();
  });

  it("a rename during the debounce writes, and books, under the new path", async () => {
    // 이것을 실패시키는 것: 쓰기나 bookkeeping(`setFileContent`·`updateLastSaveMtime`·
    // `updateFileIndex`) 중 한 자리라도 timer 를 세울 때의 경로를 씀.
    const h = mountCode();

    rename(MD, MD2);
    await advance(600);

    const { fileMtimes, openFiles } = useFileStore.getState();
    expect(writeFile).toHaveBeenCalledWith(MD2, BUFFER);
    expect(openFiles.get(MD2)).toBe(BUFFER);
    expect(openFiles.has(MD)).toBe(false);
    expect(fileMtimes.get(MD2)?.lastSaveMtime).toBe(5000 + 500); // 발화 시각
    expect(fileMtimes.has(MD)).toBe(false);
    expect(updateFileIndex).toHaveBeenCalledWith(MD2);
    expect(updateFileIndex).not.toHaveBeenCalledWith(MD);
    h.unmount();
  });
});

describe("§3.6 WYSIWYG auto-save writes under the path the tab has when it fires", () => {
  it("a rename during the debounce writes, and books, under the new path", async () => {
    // 이것을 실패시키는 것: 쓰기나 bookkeeping 중 한 자리라도 `pending.filePath`(편집 시점의
    // 경로)를 씀 — 옛 경로에 파일이 다시 생기거나 옛 키가 캐시·mtime 에 되살아난다.
    useEditorStore.setState({ sourceEditedTabs: [], sourceModeTabs: [] });
    const editor = new Editor({
      content: "<p>hello</p>",
      extensions: createBaramExtensions(),
    });
    const h = renderHook(() => useAutoSave(editor));
    await act(async () => {
      // 첫 트랜잭션은 baseline 을 잡는다 — 둘째가 진짜 편집으로 dirty 를 세운다.
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, "!");
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, "?");
    });

    rename(MD, MD2);
    await advance(600);

    const written = writeFile.mock.calls.at(-1);
    const { fileMtimes, openFiles } = useFileStore.getState();
    expect(written?.[0]).toBe(MD2);
    expect(openFiles.get(MD2)).toBe(written?.[1]);
    expect(openFiles.has(MD)).toBe(false);
    expect(fileMtimes.get(MD2)?.lastSaveMtime).toBe(5000 + 500); // 발화 시각
    expect(fileMtimes.has(MD)).toBe(false);
    expect(updateFileIndex).toHaveBeenCalledWith(MD2);
    expect(updateFileIndex).not.toHaveBeenCalledWith(MD);
    h.unmount();
    editor.destroy();
  });
});
