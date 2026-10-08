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
      // #824 `write_file` answers a `WriteOutcome`; the test settles it with the mtime.
      return new Promise((resolve) =>
        writes.push((mtime) => resolve({ indexFresh: true, mtime })),
      );
    }
    return undefined;
  }),
}));

/** Each reload waits until the test settles it. */
const reloads: Array<{ reject: (e: Error) => void; resolve: () => void }> = [];
const triggerAutoReload = vi.fn(
  () =>
    new Promise<void>((resolve, reject) => reloads.push({ reject, resolve })),
);
const showConflictModal = vi.fn();
vi.mock("../use-file-operations", () => ({
  showConflictModal: (...a: unknown[]) => showConflictModal(...a),
  triggerAutoReload: (...a: unknown[]) => triggerAutoReload(...(a as [])),
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
  showing({ dirty, id: "t1" });
  useFileStore.setState({
    fileMtimes: new Map([[NOTE, { canReloadMtime: 0, lastSaveMtime: 0 }]]),
    openFiles: new Map([[NOTE, "cached"]]),
  });
  renderHook(() => useFileWatcher());
  await settle();
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

function showing(...tabs: Array<{ dirty: boolean; id: string }>): void {
  useEditorStore.setState({
    activeTabId: tabs[0]?.id ?? null,
    tabs: tabs.map(
      ({ dirty, id }) =>
        ({ filePath: NOTE, id, isDirty: dirty, title: "hub" }) as EditorTab,
    ),
  });
}

beforeEach(() => {
  handlers.clear();
  writes.length = 0;
  reloads.length = 0;
  triggerAutoReload.mockClear();
  showConflictModal.mockReset();
  useFileStore.setState({ rootPath: "/v" });
});

describe("notifications while a reload of that path is reading", () => {
  // An atomic save's rename and its data flag both arrive as file:changed.
  // 이것을 실패시키는 것: `handleChanged` 가 진행 중인 리로드(`reloading`)를 보지 않는다.
  it("coalesce two reports of one write into one reload", async () => {
    await mounted(false);
    changed(50);
    changed(50);
    reloads.shift()?.resolve();
    await settle();
    expect(triggerAutoReload).toHaveBeenCalledTimes(1);
  });

  // No watermark outlives the reload.
  // 이것을 실패시키는 것: 끝난 리로드의 항목을 `reloading` 에서 지우지 않는다.
  it("read again for a report after the reload finished, even with the same mtime", async () => {
    await mounted(false);
    changed(50);
    reloads.shift()?.resolve();
    await settle();
    changed(50);
    await settle();
    expect(triggerAutoReload).toHaveBeenCalledTimes(2);
  });

  // 이것을 실패시키는 것: 진행 중에 온 다른 mtime 의 알림을 `again` 에 담지 않는다.
  it("read once more afterwards for a newer write that arrived meanwhile", async () => {
    await mounted(false);
    changed(50);
    changed(60);
    changed(70);
    reloads.shift()?.resolve();
    await settle();
    expect(triggerAutoReload).toHaveBeenCalledTimes(2);
    expect(triggerAutoReload.mock.calls[1]).toEqual([
      NOTE,
      70,
      { appOrigin: false },
    ]);
  });

  // 이것을 실패시키는 것: 실패한 리로드가 진행 중에 온 같은 쓰기의 알림을 다시 시도하지 않는다.
  it("try again after a failed read when the same write was reported meanwhile", async () => {
    await mounted(false);
    changed(50);
    changed(50);
    reloads.shift()?.reject(new Error("read"));
    await settle();
    expect(triggerAutoReload).toHaveBeenCalledTimes(2);
  });

  // 이것을 실패시키는 것: 실패한 리로드의 항목을 `reloading` 에서 지우지 않는다.
  it("try again when the same write is reported after a failed read", async () => {
    await mounted(false);
    changed(50);
    reloads.shift()?.reject(new Error("read"));
    await settle();
    changed(50);
    await settle();
    expect(triggerAutoReload).toHaveBeenCalledTimes(2);
  });
});

describe("the tab's own save", () => {
  // The echo can arrive before writeFile resolves, while the tab is still dirty.
  // 이것을 실패시키는 것: file:changed 리스너가 `tabSaveInFlight` 를 보지 않고 곧바로 판정한다.
  it("never opens the conflict modal or reloads over the editor for its own echo", async () => {
    await mounted(true);
    const save = asTabSave(NOTE, "t1", () => writeFile(NOTE, "saved"));
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
    const save = asTabSave(NOTE, "t1", () => writeFile(NOTE, "saved"));
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

  // An unknown mtime proves nothing about which write a change was.
  // 이것을 실패시키는 것: `asTabSave` 가 mtime 을 모를 때 `Date.now()` 로 채운다.
  it("replays a held change when the save's mtime is unknown", async () => {
    await mounted(true);
    const save = asTabSave(NOTE, "t1", () => writeFile(NOTE, "saved"));
    await settle();
    changed(100, "external");
    writes.shift()?.(0);
    await act(async () => {
      await save;
    });
    await settle();
    expect(showConflictModal).toHaveBeenCalledTimes(1);
  });

  // 이것을 실패시키는 것: `ownSaveCovers` 가 지금 그 경로를 보여 주는 탭을 보지 않고 mtime 만 본다.
  it("tells the tab that reopened the file while the save ran", async () => {
    await mounted(true);
    const save = asTabSave(NOTE, "t1", () => writeFile(NOTE, "saved"));
    await settle();
    changed(100, "app");
    // t1 closes, and the file opens again in t2 before the write lands.
    showing({ dirty: false, id: "t2" });
    writes.shift()?.(100);
    await act(async () => {
      await save;
    });
    await settle();
    expect(triggerAutoReload).toHaveBeenCalledTimes(1);
  });

  // 이것을 실패시키는 것: 위와 같다.
  it("tells the other tab showing a path that a Save As wrote onto", async () => {
    await mounted(false);
    // t1 saves its text as NOTE, which t2 already shows.
    showing({ dirty: false, id: "t2" });
    const save = asTabSave(NOTE, "t1", () => writeFile(NOTE, "saved as"));
    await settle();
    changed(100, "app");
    writes.shift()?.(100);
    await act(async () => {
      await save;
    });
    // The Save As site renames t1 onto NOTE once the write lands.
    showing({ dirty: false, id: "t1" }, { dirty: false, id: "t2" });
    await settle();
    expect(triggerAutoReload).toHaveBeenCalledTimes(1);
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
