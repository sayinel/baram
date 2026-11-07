// §3.5 닫은 파일은 watcher 가 다시 읽지 않고, 다시 열면 디스크에서 새로 읽는다 (#798).
//
// watcher 의 `file:changed` 처리는 `openFiles` 에 있는 파일을 "열려 있다" 고 본다. 탭을 닫아도
// 원문이 남아 있던 동안은 닫은 파일이 밖에서 바뀌면 탭도 없는데 다시 읽었다.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const disk = new Map<string, string>();
/** 파일을 열 때의 읽기(`ipc/fs`). */
const openRead = vi.fn(async (path: string) => disk.get(path) ?? "");
/** 바뀐 파일을 다시 읽는 자동 리로드의 읽기(`ipc/invoke`). */
const reloadRead = vi.fn(async (path: string) => disk.get(path) ?? "");

type ChangedHandler = (e: { payload: { mtime: number; path: string } }) => void;
let onFileChanged: ChangedHandler | null = null;

vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: unknown) => {
    if (name === "file:changed") onFileChanged = handler as ChangedHandler;
    return Promise.resolve(() => undefined);
  },
}));
vi.mock("../../ipc/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/fs")>()),
  readFile: (path: string) => openRead(path),
}));
vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  readFile: (path: string) => reloadRead(path),
  updateFileIndex: () => Promise.resolve(),
  watchDir: () => Promise.resolve(),
}));
vi.mock("../../plugins/plugin-lifecycle", () => ({ notifyFileOpen: vi.fn() }));
vi.mock("../../services/vault-context-loader", () => ({
  switchContext: async () => undefined,
}));

import { useContextStore } from "../../stores/context/context";
import { startClosedTabRelease } from "../../stores/editor/closed-tab-release";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { openFileByPath } from "../../utils/open-file";
import { useFileWatcher } from "../use-file-watcher";

const NOTE = "/v/note.md";
let stop: () => void = () => undefined;

async function fileChanged(path: string, mtime: number) {
  await act(async () => {
    onFileChanged!({ payload: { mtime, path } });
    await Promise.resolve();
  });
}

beforeEach(async () => {
  disk.clear();
  disk.set(NOTE, "first");
  openRead.mockClear();
  reloadRead.mockClear();
  onFileChanged = null;
  useFileStore.setState({ fileMtimes: new Map(), openFiles: new Map() });
  useEditorStore.setState({ activeTabId: null, mruOrder: [], tabs: [] });
  useContextStore.setState({
    activeContextId: null,
    contexts: [],
    ensureFileContext: vi.fn(async () => ({ id: "ctx1" })),
  } as never);
  stop = startClosedTabRelease();
  renderHook(() => useFileWatcher());
  await act(async () => {
    await Promise.resolve();
  });
});

afterEach(() => stop());

describe("§3.5 a closed file is not watched and reopens from disk (#798)", () => {
  it("reloads an open file that changed outside the app", async () => {
    // 긍정 짝 — 같은 사건이 열린 파일에서는 다시 읽기를 일으킨다.
    await openFileByPath(NOTE);
    disk.set(NOTE, "changed outside");
    await fileChanged(NOTE, 5_000);
    expect(reloadRead).toHaveBeenCalledTimes(1);
    expect(useFileStore.getState().openFiles.get(NOTE)).toBe("changed outside");
  });

  // 이것을 실패시키는 것: closed-tab-release.ts 의 구독을 지우면 닫은 파일의 원문이 남아 watcher 가
  // 그것을 "열려 있다" 고 보고 한 번 다시 읽는다.
  it("does not reread a closed file that changed outside the app", async () => {
    await openFileByPath(NOTE);
    const tabId = useEditorStore.getState().tabs[0].id;
    act(() => useEditorStore.getState().closeTab(tabId));

    disk.set(NOTE, "changed outside");
    await fileChanged(NOTE, 5_000);

    expect(reloadRead).toHaveBeenCalledTimes(0);
    expect(useFileStore.getState().openFiles.size).toBe(0);
  });

  it("reads the file from disk again when it is reopened", async () => {
    await openFileByPath(NOTE);
    const tabId = useEditorStore.getState().tabs[0].id;
    act(() => useEditorStore.getState().closeTab(tabId));
    disk.set(NOTE, "second");

    await openFileByPath(NOTE);

    expect(openRead).toHaveBeenCalledTimes(2);
    expect(useFileStore.getState().openFiles.get(NOTE)).toBe("second");
    expect(useEditorStore.getState().tabs).toHaveLength(1);
  });
});
