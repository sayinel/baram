// §34 issue 791 — 저장은 Rust 가 index 를 고친 뒤 `index:changed` 를 한 번 내고(#824), 그 쓰기의
// watcher 메아리는 Rust 의 applier 가 다시 맞춘 뒤 `index:changed` 를 한 번 더 낸다. 둘 다 저장한
// 파일을 알려야 Backlinks 가 보고 있는 노트의 저장마다 mention 검색을 다시 하지 않는다. `file:*` 는
// index 를 약속하지 않으므로 그것만으로는 아무것도 올리지 않는다. Rust 쪽 announce 는
// `index/service/applier_tests.rs` 가 router 부터 고정한다.
import { act, render } from "@testing-library/react";
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
  writeFile: vi.fn().mockResolvedValue(undefined),
  // tauri-storage(설정 store 영속화)가 ipc/invoke 재export 로 부른다
  getConfig: vi.fn().mockResolvedValue(null),
  setConfig: vi.fn().mockResolvedValue(undefined),
}));

import type { EditorTab } from "../../../stores/editor/editor";

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

/** 리스너 등록과 검색 effect 가 끝날 때까지. */
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

describe("Backlinks and the watcher echo of a save", () => {
  // 이것을 실패시키는 것: services/index-changes.ts 가 항목 하나인 `index:changed` 에도 `invalidate()` 를
  // 부른다(메아리가 원인 모를 신호가 되어 저장마다 검색한다).
  it("does not search again for a save of the viewed note or its watcher echo", async () => {
    await installIndexChanges();
    render(<Backlinks />);
    await settle();
    getUnlinkedMentions.mockClear();

    for (let i = 0; i < 5; i++) {
      act(() => indexChanged([A])); // 저장 자신(`write_file` 의 이벤트)
      await settle();
      emitChanged(A, i); // 그 쓰기의 watcher 메아리 — index 를 약속하지 않는다
      await settle();
      act(() => indexChanged([A])); // applier 가 그 메아리를 맞춘 뒤의 이벤트
      await settle();
    }

    // `file:changed` 는 아무것도 올리지 않는다.
    expect(useLinkStore.getState().indexVersion).toBe(10);
    expect(getUnlinkedMentions).toHaveBeenCalledTimes(0);

    // 다른 노트의 쓰기는 다시 찾는다 — 위의 0 이 검색 경로가 죽어서가 아니다.
    act(() => indexChanged(["/v/b.md"]));
    await settle();
    expect(getUnlinkedMentions).toHaveBeenCalledTimes(1);
  });
});
