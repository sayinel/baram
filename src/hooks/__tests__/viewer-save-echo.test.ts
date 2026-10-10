// §392 · §3.2 An editable viewer's save is the tab's own save (issue 795 · #845).
//
// The viewer re-arms code auto-save (`rearmForViewerEdit`), and the HTML / viewer preview flushes
// the buffer when leaving source view. Both write through `asTabSave`, so the watcher's echo of
// that write is recognised as the tab's own: no reload over the buffer and no conflict modal.
// Both also record the save's mtime, which is the viewer's refresh key (`previewFileMtime`).
// Real listener, real `writeFile` queue and real tab-save announcement; only the Tauri transport
// and the two outcomes — reload and conflict modal — are doubles.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (e: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (event: string, handler: (e: { payload: unknown }) => void) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
  ),
}));

/** Each `write_file` waits until the test settles it with the mtime it reports. */
const writes: Array<(mtime: number) => void> = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "write_file") {
      return new Promise((resolve) =>
        writes.push((mtime) => resolve({ indexFresh: true, mtime })),
      );
    }
    return undefined;
  }),
}));

const triggerAutoReload = vi.fn(async () => undefined);
const showConflictModal = vi.fn();
vi.mock("../use-file-operations", () => ({
  showConflictModal: (...a: unknown[]) => showConflictModal(...a),
  triggerAutoReload: (...a: unknown[]) => triggerAutoReload(...(a as [])),
}));

import type { EditorTab } from "../../stores/editor/editor";

import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useCodeAutoSave } from "../use-code-auto-save";
import { useFileWatcher } from "../use-file-watcher";
import { usePreviewSourceView } from "../use-preview-source-view";

const SKETCH = "/v/pad.strokes";
const PAGE = "/v/page.html";
const TAB = "t1";

function changed(path: string, mtime: number): void {
  act(() =>
    handlers.get("file:changed")?.({
      payload: { mtime, origin: "app", path },
    }),
  );
}

function lastSaveMtime(path: string): number | undefined {
  return useFileStore.getState().fileMtimes.get(path)?.lastSaveMtime;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function showDirty(path: string): Promise<void> {
  useEditorStore.setState({
    activeTabId: TAB,
    previewSourceTabs: [TAB],
    sourceEditedTabs: [],
    sourceModeTabs: [],
    tabs: [{ filePath: path, id: TAB, isDirty: true, title: "t" } as EditorTab],
  } as never);
  useFileStore.setState({
    fileMtimes: new Map([[path, { canReloadMtime: 0, lastSaveMtime: 10 }]]),
    openFiles: new Map([[path, "before"]]),
    rootPath: "/v",
  });
  renderHook(() => useFileWatcher());
  await settle();
}

beforeEach(() => {
  vi.useRealTimers();
  handlers.clear();
  writes.length = 0;
  triggerAutoReload.mockClear();
  showConflictModal.mockClear();
  useSettingsStore.setState({ autoSave: true, autoSaveDelay: 1 } as never);
});

// 이것을 실패시키는 것: use-code-auto-save.ts 의 `saveFromBuffer` 가 `asTabSave` 를 거치지 않고 `writeFile`
// 을 바로 부르게 하면, 아직 dirty 인 동안 온 메아리가 남의 변경으로 읽혀 충돌 모달이 열린다.
describe("§392 an editable viewer's auto-save is the tab's own save", () => {
  it("gets 0 reloads and 0 conflicts for its echo, and moves the viewer's refresh key", async () => {
    await showDirty(SKETCH);
    const { result } = renderHook(() =>
      useCodeAutoSave({
        bufferVersion: 1,
        getSourceBuffer: () => "drawn",
        isEditableTextFile: true,
        markDirty: (id, d) => useEditorStore.getState().markDirty(id, d),
        sourceModeTabs: new Set(),
      }),
    );
    act(() => result.current.rearmForViewerEdit(TAB));
    await settle();
    expect(writes).toHaveLength(1);

    changed(SKETCH, 500);
    changed(SKETCH, 500);
    writes.shift()?.(500);
    await settle();

    expect(triggerAutoReload).not.toHaveBeenCalled();
    expect(showConflictModal).not.toHaveBeenCalled();
    expect(lastSaveMtime(SKETCH)).toBe(500);
  });

  it("still reloads for a change the tab did not write", async () => {
    // 긍정 짝 — 같은 판정이 남의 쓰기에는 리로드를 낸다(탭이 깨끗하면).
    await showDirty(SKETCH);
    useEditorStore.getState().markDirty(TAB, false);
    changed(SKETCH, 900);
    await settle();
    expect(triggerAutoReload).toHaveBeenCalledTimes(1);
    expect(showConflictModal).not.toHaveBeenCalled();
  });
});

// 이것을 실패시키는 것: use-preview-source-view.ts 의 flush 가 `asTabSave` 를 거치지 않게 하면 같은 메아리가
// 충돌 모달을 연다.
describe("§392 leaving source view flushes as the tab's own save", () => {
  it("gets 0 reloads and 0 conflicts for its echo, and moves the viewer's refresh key", async () => {
    await showDirty(PAGE);
    const { result } = renderHook(() =>
      usePreviewSourceView({
        getSourceBuffer: () => "<p>edited</p>",
        markDirty: (id, d) => useEditorStore.getState().markDirty(id, d),
        toggleSourceMode: () => undefined,
      }),
    );
    act(() => result.current.toggleHtmlView());
    await settle();
    expect(writes).toHaveLength(1);

    changed(PAGE, 700);
    writes.shift()?.(700);
    await settle();

    expect(triggerAutoReload).not.toHaveBeenCalled();
    expect(showConflictModal).not.toHaveBeenCalled();
    expect(lastSaveMtime(PAGE)).toBe(700);
  });
});
