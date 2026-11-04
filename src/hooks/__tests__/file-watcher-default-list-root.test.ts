// §3.2 #823 C — the file tree hears a created file unless the vault walk and the tree leave
// it out: the default list names folders DIRECTLY under the vault root, as `list_dir` and the
// walk judge them. End to end through the real `file:created` listener and the tree flush.
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

vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  setOpenFiles: vi.fn(async () => {}),
  unwatchDir: vi.fn(async () => {}),
  watchDir: vi.fn(async () => 1),
}));

import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useFileWatcher } from "../use-file-watcher";

const addFileEntry = vi.fn();

async function mounted(rootPath: string): Promise<void> {
  useEditorStore.setState({ activeTabId: null, tabs: [] });
  useFileStore.setState({
    addFileEntry,
    fileMtimes: new Map(),
    openFiles: new Map(),
    rootPath,
  });
  renderHook(() => useFileWatcher());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** The paths the tree was told about, after the watcher's 300 ms batch. */
async function created(paths: string[]): Promise<string[]> {
  for (const path of paths) {
    act(() =>
      handlers.get("file:created")?.({
        payload: { isDir: false, origin: "external", path },
      }),
    );
  }
  await act(async () => {
    await new Promise((r) => setTimeout(r, 350));
  });
  return addFileEntry.mock.calls.map(
    ([, entry]) => (entry as { path: string }).path,
  );
}

beforeEach(() => {
  handlers.clear();
  addFileEntry.mockClear();
});

describe("a created file and the default list", () => {
  // 이것을 실패시키는 것: `shouldSkip` 이 기본 목록을 루트 아래 모든 깊이에서 본다(`Projects/build/n.md` 가
  // 빠진다) — 또는 루트의 첫 구간에서도 보지 않는다(`build/out.md` 가 트리에 들어온다).
  it("leaves out a folder of the list directly under the root and keeps a deeper one", async () => {
    await mounted("/v");
    expect(
      await created(["/v/build/out.md", "/v/Projects/build/n.md", "/v/a.md"]),
    ).toEqual(["/v/Projects/build/n.md", "/v/a.md"]);
  });

  // 이것을 실패시키는 것: `shouldSkip` 이 볼트 루트 위의 경로 구간도 본다 — `build` 폴더 안에 둔 볼트는 트리에
  // 아무 이벤트도 받지 못한다.
  it("does not judge the folders above the vault root", async () => {
    await mounted("/w/build/v");
    expect(await created(["/w/build/v/a.md"])).toEqual(["/w/build/v/a.md"]);
  });
});
