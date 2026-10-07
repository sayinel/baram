// §34 issue 791 — 저장은 index 를 고치고 `invalidate(path)` 를 부른 뒤, 그 쓰기의 watcher 이벤트가
// `use-link-index-watcher` 를 거쳐 한 번 더 `indexVersion` 을 올린다(issue 790). 그 메아리도 저장한
// 파일을 알려야 Backlinks 가 보고 있는 노트의 저장마다 mention 검색을 다시 하지 않는다.
// 실제 seam 으로 센다 — 워처 hook 과 Backlinks 를 함께 마운트하고 getUnlinkedMentions 호출 수를 본다.
import { act, render, renderHook } from "@testing-library/react";
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

const getUnlinkedMentions = vi.fn();
vi.mock("../../../ipc/invoke", () => ({
  getBacklinks: vi.fn().mockResolvedValue([]),
  getUnlinkedMentions: (...a: unknown[]) => getUnlinkedMentions(...a),
  readFile: vi.fn().mockResolvedValue(""),
  refreshIndex: vi.fn().mockResolvedValue(undefined),
  syncWatchedPaths: vi.fn(async (paths: string[]) => ({
    applied: paths.length,
    distinct: paths.length,
    failed: [],
  })),
  updateFileIndex: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  // tauri-storage(설정 store 영속화)가 ipc/invoke 재export 로 부른다
  getConfig: vi.fn().mockResolvedValue(null),
  setConfig: vi.fn().mockResolvedValue(undefined),
}));

import type { EditorTab } from "../../../stores/editor/editor";

import { useLinkIndexWatcher } from "../../../hooks/use-link-index-watcher";
import { useEditorStore } from "../../../stores/editor/editor";
import { useLinkStore } from "../../../stores/editor/link";
import { useFileStore } from "../../../stores/file/file";
import { Backlinks } from "../Backlinks";

const A = "/v/a.md";

function emitChanged(path: string, mtime: number): void {
  act(() =>
    handlers.get("file:changed")?.({
      payload: { mtime, origin: "app", path },
    }),
  );
}

/** 리스너 등록 · flush 타이머(300 ms) · 검색 effect 가 끝날 때까지. */
async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  handlers.clear();
  getUnlinkedMentions.mockReset().mockResolvedValue([]);
  useFileStore.setState({ rootPath: "/v" });
  useLinkStore.setState({ indexVersion: 0, savedPath: null });
  useEditorStore.setState({
    activeTabId: "t1",
    tabs: [{ filePath: A, id: "t1", title: "a" } as EditorTab],
  });
});

describe("Backlinks with the link-index watcher mounted", () => {
  // 이것을 실패시키는 것: use-link-index-watcher.ts 가 경로 하나인 flush 에서도 `invalidate()` 를
  // 부른다(메아리가 원인 모를 신호가 되어 저장마다 검색한다).
  it("does not search again for a save of the viewed note or its watcher echo", async () => {
    render(<Backlinks />);
    renderHook(() => useLinkIndexWatcher());
    await settle();
    getUnlinkedMentions.mockClear();

    for (let i = 0; i < 5; i++) {
      act(() => useLinkStore.getState().invalidate(A)); // 저장 자신
      await settle();
      emitChanged(A, i); // 그 쓰기의 watcher 메아리
      await settle();
    }

    expect(useLinkStore.getState().indexVersion).toBe(10);
    expect(getUnlinkedMentions).toHaveBeenCalledTimes(0);

    // 다른 노트의 쓰기는 다시 찾는다 — 위의 0 이 검색 경로가 죽어서가 아니다.
    emitChanged("/v/b.md", 9);
    await settle();
    expect(getUnlinkedMentions).toHaveBeenCalledTimes(1);
  });
});
