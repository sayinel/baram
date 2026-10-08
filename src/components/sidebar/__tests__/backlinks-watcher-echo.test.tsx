// §34 issue 791 — 저장은 Rust 가 index 를 고친 뒤 `index:changed` 를 한 번 내고(#824), 그 쓰기의
// watcher 이벤트가 `sync_watched_paths` 를 거쳐 `index:changed` 를 한 번 더 낸다(issue 790). 둘 다
// 저장한 파일을 알려야 Backlinks 가 보고 있는 노트의 저장마다 mention 검색을 다시 하지 않는다.
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
  // What Rust's `sync_watched_paths` announces: one `index:changed` for the batch.
  syncWatchedPaths: vi.fn(async (paths: string[]) => {
    indexChanged(paths);
    return { applied: paths.length, distinct: paths.length, failed: [] };
  }),
  writeFile: vi.fn().mockResolvedValue(undefined),
  // tauri-storage(설정 store 영속화)가 ipc/invoke 재export 로 부른다
  getConfig: vi.fn().mockResolvedValue(null),
  setConfig: vi.fn().mockResolvedValue(undefined),
}));

import type { EditorTab } from "../../../stores/editor/editor";

import { useLinkIndexWatcher } from "../../../hooks/use-link-index-watcher";
import { installIndexChanges } from "../../../services/index-changes";
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

/** Rust's `index:changed` for `paths`, each its own entry. */
function indexChanged(paths: string[]): void {
  handlers.get("index:changed")?.({
    payload: {
      entries: paths.map((p) => ({ canonical: p, spellings: [p] })),
      rebuilt: [],
    },
  });
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
  // 이것을 실패시키는 것: services/index-changes.ts 가 항목 하나인 `index:changed` 에도 `invalidate()` 를
  // 부른다(메아리가 원인 모를 신호가 되어 저장마다 검색한다).
  it("does not search again for a save of the viewed note or its watcher echo", async () => {
    await installIndexChanges();
    render(<Backlinks />);
    renderHook(() => useLinkIndexWatcher());
    await settle();
    getUnlinkedMentions.mockClear();

    for (let i = 0; i < 5; i++) {
      act(() => indexChanged([A])); // 저장 자신(`write_file` 의 이벤트)
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
