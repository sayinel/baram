// §3.2 issue 795 — what the change listener does with the file:changed events the
// watcher sends for an open file. Real listener, real `writeFile` queue (src/ipc/fs.ts)
// and real tab-save announcement; only the Tauri transport and the two outcomes —
// reload and conflict modal — are doubles, so each case counts outcomes.
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
      return new Promise<number>((resolve) => writes.push(resolve));
    }
    return undefined;
  }),
}));

const triggerAutoReload = vi.fn();
const showConflictModal = vi.fn();
vi.mock("../use-file-operations", () => ({
  showConflictModal: (...a: unknown[]) => showConflictModal(...a),
  triggerAutoReload: (...a: unknown[]) => triggerAutoReload(...a),
}));

import type { EditorTab } from "../../stores/editor/editor";

import { writeFile } from "../../ipc/fs";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { asTabSave } from "../../utils/editor/tab-save-in-flight";
import { useFileWatcher } from "../use-file-watcher";

const NOTE = "/v/hub.md";

function changed(mtime: number, origin: "app" | "external" = "external"): void {
  act(() =>
    handlers.get("file:changed")?.({
      payload: { mtime, origin, path: NOTE },
    }),
  );
}

async function mounted(dirty: boolean): Promise<void> {
  openTab(dirty);
  renderHook(() => useFileWatcher());
  await settle();
}

function openTab(dirty: boolean): void {
  useEditorStore.setState({
    activeTabId: "t1",
    tabs: [
      { filePath: NOTE, id: "t1", isDirty: dirty, title: "hub" } as EditorTab,
    ],
  });
  useFileStore.setState({
    fileMtimes: new Map([[NOTE, { canReloadMtime: 0, lastSaveMtime: 0 }]]),
    openFiles: new Map([[NOTE, "cached"]]),
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  handlers.clear();
  writes.length = 0;
  triggerAutoReload.mockReset().mockResolvedValue(undefined);
  showConflictModal.mockReset();
  useFileStore.setState({ rootPath: "/v" });
});

describe("one external change is acted on once per (path, mtime)", () => {
  // An atomic save's rename and its data flag both arrive as file:changed.
  // 이것을 실패시키는 것: `handleChanged` 의 `handledMtime` 검사를 지운다.
  it("reloads once for two reports of one write, and again for the next write", async () => {
    await mounted(false);
    changed(50);
    changed(50);
    await settle();
    expect(triggerAutoReload).toHaveBeenCalledTimes(1);
    changed(51);
    await settle();
    expect(triggerAutoReload).toHaveBeenCalledTimes(2);
    // The dedupe has its own field; auto-save's guard still sees the newest change.
    expect(useFileStore.getState().getFileMtime(NOTE)?.canReloadMtime).toBe(51);
  });
});

describe("the tab's own save", () => {
  // The echo can arrive before writeFile resolves, while the tab is still dirty.
  // 이것을 실패시키는 것: file:changed 리스너가 `tabSaveInFlight` 를 보지 않고 곧바로 판정한다.
  it("never opens the conflict modal or reloads over the editor for its own echo", async () => {
    await mounted(true);
    const save = asTabSave(NOTE, () => writeFile(NOTE, "saved"));
    await settle();
    changed(100, "app");
    changed(100, "app");
    writes.shift()?.(100);
    await act(async () => {
      await save;
    });
    await settle();
    expect(showConflictModal).not.toHaveBeenCalled();
    expect(triggerAutoReload).not.toHaveBeenCalled();
  });

  // 이것을 실패시키는 것: 보류한 변경을 저장의 mtime 과 상관없이 버린다.
  it("still reports a change made by somebody else while the save ran", async () => {
    await mounted(true);
    const save = asTabSave(NOTE, () => writeFile(NOTE, "saved"));
    await settle();
    changed(100, "app");
    changed(200, "external");
    writes.shift()?.(100);
    await act(async () => {
      await save;
    });
    await settle();
    expect(showConflictModal).toHaveBeenCalledTimes(1);
    expect(showConflictModal.mock.calls[0][1]).toBe(200);
  });
});

describe("another in-app writer's change reaches the tab", () => {
  // Global search replace, journal and zettelkasten services, plugins and the PDF
  // companion write an open file through the same `writeFile` without touching its
  // tab. Their change must reload a clean tab and stop a dirty one with the modal.
  // 이것을 실패시키는 것: src/ipc/fs.ts 의 `writeFile` 이 모든 쓰기를 `asTabSave` 로 알린다(감추는
  // 자리를 wrapper 로 옮긴다).
  it("reloads a clean tab once", async () => {
    await mounted(false);
    const write = writeFile(NOTE, "replaced");
    await settle();
    changed(300, "app");
    writes.shift()?.(300);
    await act(async () => {
      await write;
    });
    await settle();
    expect(triggerAutoReload).toHaveBeenCalledTimes(1);
    expect(showConflictModal).not.toHaveBeenCalled();
  });

  // 이것을 실패시키는 것: 위와 같다.
  it("opens the conflict modal once for a dirty tab", async () => {
    await mounted(true);
    const write = writeFile(NOTE, "replaced");
    await settle();
    changed(300, "app");
    writes.shift()?.(300);
    await act(async () => {
      await write;
    });
    await settle();
    expect(showConflictModal).toHaveBeenCalledTimes(1);
    expect(triggerAutoReload).not.toHaveBeenCalled();
  });
});
