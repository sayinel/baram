// §3.2 issue 797 — while a folder's watch changes scope, the new watcher starts before
// the old one stops, so for that moment one write can be reported by both (as FSEvents
// itself may report it twice). End to end through the real listener and the real
// reload: a clean tab reads the file once, a dirty tab gets one modal.
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

const readFile = vi.fn(async () => "from disk");
vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  readFile: () => readFile(),
  setOpenFiles: vi.fn(async () => {}),
  unwatchDir: vi.fn(async () => {}),
  watchDir: vi.fn(async () => 1),
}));

import type { EditorTab } from "../../stores/editor/editor";

import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useUIStore } from "../../stores/ui/ui";
import { useFileWatcher } from "../use-file-watcher";

const NOTE = "/v/a.md";

async function mounted(dirty: boolean): Promise<void> {
  useEditorStore.setState({
    activeTabId: "t1",
    tabs: [
      { filePath: NOTE, id: "t1", isDirty: dirty, title: "a" } as EditorTab,
    ],
  });
  useFileStore.setState({
    fileMtimes: new Map([[NOTE, { canReloadMtime: 0, lastSaveMtime: 0 }]]),
    openFiles: new Map([[NOTE, "cached"]]),
    rootPath: "/v",
  });
  renderHook(() => useFileWatcher());
  await settle();
}

function report(mtime: number): void {
  act(() =>
    handlers.get("file:changed")?.({
      payload: { mtime, origin: "external", path: NOTE },
    }),
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  handlers.clear();
  readFile.mockClear();
  useUIStore.setState({ conflictModal: null });
});

describe("one write reported by two watchers", () => {
  // Coalesced while the first read runs (#795), and after it the reload's own
  // `lastSaveMtime` covers the second report.
  it("reads a clean tab's file once, whether the second report comes during or after the read", async () => {
    await mounted(false);
    report(40);
    report(40);
    await settle();
    report(40);
    await settle();
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  // 이것을 실패시키는 것: `showConflictModal` 이 같은 (경로, mtime) 의 모달이 이미 떠 있어도 다시 연다.
  it("opens one modal for a dirty tab", async () => {
    await mounted(true);
    const opened: string[] = [];
    const stop = useUIStore.subscribe((state, prev) => {
      if (state.conflictModal !== prev.conflictModal && state.conflictModal) {
        opened.push(state.conflictModal.filePath);
      }
    });
    report(40);
    report(40);
    await settle();
    stop();
    expect(opened).toEqual([NOTE]);
  });
});
