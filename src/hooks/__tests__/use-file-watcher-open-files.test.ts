// §3.2 issue 795 — the Rust watcher drops events below excluded folders except for the
// files open in the editor. The hook must tell it which those are — before the watch
// starts and on every change — and an open file's change below such a folder must
// reach the editor's reload and conflict checks.
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

const order: string[] = [];
const setOpenFiles = vi.fn();
const watchDir = vi.fn();
vi.mock("../../ipc/invoke", () => ({
  setOpenFiles: (...a: unknown[]) => setOpenFiles(...a),
}));
// The watch service asks through `ipc/fs` (#797).
vi.mock("../../ipc/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/fs")>()),
  unwatchDir: vi.fn(async () => {}),
  watchDir: (...a: unknown[]) => watchDir(...a),
}));

const triggerAutoReload = vi.fn();
const showConflictModal = vi.fn();
vi.mock("../use-file-operations", () => ({
  showConflictModal: (...a: unknown[]) => showConflictModal(...a),
  triggerAutoReload: (...a: unknown[]) => triggerAutoReload(...a),
}));

import type { EditorTab } from "../../stores/editor/editor";

import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useUIStore } from "../../stores/ui/ui";
import { useFileWatcher } from "../use-file-watcher";

const OPEN = "/v/build/README.md";

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function tabs(...paths: string[]): void {
  useEditorStore.setState({
    tabs: paths.map(
      (filePath, i) => ({ filePath, id: `t${i}`, isDirty: false }) as EditorTab,
    ),
  });
}

beforeEach(() => {
  handlers.clear();
  order.length = 0;
  setOpenFiles.mockReset().mockImplementation(async () => {
    order.push("setOpenFiles");
  });
  watchDir.mockReset().mockImplementation(async () => {
    order.push("watchDir");
  });
  triggerAutoReload.mockReset().mockResolvedValue(undefined);
  showConflictModal.mockReset();
  useFileStore.setState({ fileMtimes: new Map(), openFiles: new Map() });
  useFileStore.setState({ rootPath: "/v" });
  tabs();
});

describe("useFileWatcher registers the open files with the watcher", () => {
  // 이것을 실패시키는 것: use-watch-leases.ts 에서 `registerOpenFiles(openFilePaths)` effect 를 지운다.
  it("sends the open set on mount and again whenever it changes", async () => {
    tabs(OPEN);
    renderHook(() => useFileWatcher());
    await settle();
    expect(setOpenFiles).toHaveBeenLastCalledWith([OPEN]);

    act(() => tabs(OPEN, "/v/notes/a.md"));
    await settle();
    expect(setOpenFiles).toHaveBeenLastCalledWith([OPEN, "/v/notes/a.md"]);

    act(() => tabs());
    await settle();
    expect(setOpenFiles).toHaveBeenLastCalledWith([]);
  });

  // 이것을 실패시키는 것: rootPath effect 가 `registerOpenFiles` 를 기다리지 않고 `watchDir` 를
  // 곧바로 부른다(이 이슈 전의 코드).
  it("registers the restored tabs before the watch that would drop their events starts", async () => {
    tabs(OPEN);
    renderHook(() => useFileWatcher());
    await settle();
    expect(watchDir).toHaveBeenCalledWith("/v", {});
    expect(order.indexOf("setOpenFiles")).toBeLessThan(
      order.indexOf("watchDir"),
    );
  });

  // 이것을 실패시키는 것: `watchDir` 를 `setOpenFiles` 의 성공에만 잇는다(`.then`).
  it("starts the watch even when registering the open set fails", async () => {
    setOpenFiles.mockRejectedValue(new Error("ipc"));
    renderHook(() => useFileWatcher());
    await settle();
    expect(watchDir).toHaveBeenCalledWith("/v", {});
  });

  // The watcher then filters nothing (watch_filter.rs) — safe, but not silent.
  // 이것을 실패시키는 것: `registerOpenFiles` 의 실패 갈래에서 toast 를 지운다 — 또는 실패마다 띄운다.
  it("says once that registration failed, and again only after it recovered", async () => {
    const warnings: string[] = [];
    const stop = useUIStore.subscribe((state, prev) => {
      if (state.toast !== prev.toast && state.toast?.type === "warning") {
        warnings.push(state.toast.message);
      }
    });
    tabs(OPEN);
    renderHook(() => useFileWatcher());
    await settle(); // a success first, whatever an earlier test left behind
    setOpenFiles.mockRejectedValue(new Error("ipc"));
    act(() => tabs(OPEN, "/v/notes/a.md"));
    await settle();
    act(() => tabs("/v/notes/a.md"));
    await settle();
    expect(warnings).toHaveLength(1);

    setOpenFiles.mockResolvedValue(undefined);
    act(() => tabs(OPEN));
    await settle();
    setOpenFiles.mockRejectedValue(new Error("ipc"));
    act(() => tabs());
    await settle();
    expect(warnings).toHaveLength(2);
    stop();
  });
});

describe("an open file below an excluded folder reaches the reload check", () => {
  // Rust reports another program's atomic save of an open file as file:changed too
  // (watch_filter.rs); this is the last hop. The tree filter must not stand in it.
  // 이것을 실패시키는 것: file:changed 리스너가 트리용 `shouldSkip(filePath)` 로 거른다.
  it("reloads the open file and ignores its unopened sibling", async () => {
    tabs(OPEN);
    useFileStore.setState({ openFiles: new Map([[OPEN, "old"]]) });
    renderHook(() => useFileWatcher());
    await settle();

    act(() =>
      handlers.get("file:changed")?.({
        payload: { mtime: 5, origin: "external", path: OPEN },
      }),
    );
    act(() =>
      handlers.get("file:changed")?.({
        payload: { mtime: 5, origin: "external", path: "/v/build/other.md" },
      }),
    );
    await settle();

    expect(triggerAutoReload).toHaveBeenCalledTimes(1);
    expect(triggerAutoReload.mock.calls[0][0]).toBe(OPEN);
    expect(showConflictModal).not.toHaveBeenCalled();
  });
});
