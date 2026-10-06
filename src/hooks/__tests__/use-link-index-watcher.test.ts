// §29 워처가 본 변경을 링크 index 에 넘기는지 — 실제 seam(리스너 등록 → 이벤트 → syncWatchedPaths
// 호출 → indexVersion · savedPath)으로 센다(issue 790). 경로 판정은 Rust 몫이라 여기서는 모든
// 경로를 그대로 넘기는지만 본다.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

const syncWatchedPaths = vi.fn();
vi.mock("../../ipc/invoke", () => ({
  syncWatchedPaths: (...a: unknown[]) => syncWatchedPaths(...a),
}));

import { listen } from "@tauri-apps/api/event";

import { useLinkStore } from "../../stores/editor/link";
import { useLinkIndexWatcher } from "../use-link-index-watcher";

const handlers = new Map<string, (e: { payload: unknown }) => void>();
const unlistened: string[] = [];

function emit(event: string, payload: unknown): void {
  act(() => handlers.get(event)?.({ payload }));
}

/** 리스너 등록과 flush 타이머(300 ms)를 지나 sync 가 끝날 때까지. */
async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
}

function synced(): string[][] {
  return syncWatchedPaths.mock.calls.map((c) => [...(c[0] as string[])].sort());
}

function version(): number {
  return useLinkStore.getState().indexVersion;
}

beforeEach(() => {
  vi.useFakeTimers();
  handlers.clear();
  unlistened.length = 0;
  syncWatchedPaths.mockReset().mockImplementation(async (paths: string[]) => ({
    applied: paths.length,
    failed: [],
  }));
  vi.mocked(listen).mockImplementation(async (event, handler) => {
    handlers.set(event, handler as (e: { payload: unknown }) => void);
    return () => {
      unlistened.push(event);
      handlers.delete(event);
    };
  });
  useLinkStore.setState({ indexVersion: 0, savedPath: null });
});

describe("useLinkIndexWatcher", () => {
  // 이것을 실패시키는 것: `pending` 이 경로를 중복 없이 모으지 않는다(같은 경로를 두 번 담는다).
  it("hands a burst to Rust once, one entry per path, and names no saved file", async () => {
    renderHook(() => useLinkIndexWatcher());
    await settle();

    // FSEvents 는 한 번의 쓰기에 이벤트를 여럿 올린다.
    emit("file:changed", { mtime: 1, origin: "external", path: "/v/x.md" });
    emit("file:changed", { mtime: 1, origin: "external", path: "/v/x.md" });
    emit("file:created", { isDir: true, origin: "external", path: "/v/dir" });
    emit("file:deleted", { path: "/v/paper.pdf" });
    await settle();

    expect(synced()).toEqual([["/v/dir", "/v/paper.pdf", "/v/x.md"]]);
    expect(version()).toBe(1);
    expect(useLinkStore.getState().savedPath).toBeNull();
  });

  // 이것을 실패시키는 것: 리스너에 `if (e.payload.origin === "app") return;` 를 되돌린다.
  it("hands over the app's own writes — Quick Capture and its kind never call updateFileIndex", async () => {
    renderHook(() => useLinkIndexWatcher());
    await settle();

    emit("file:changed", { mtime: 1, origin: "app", path: "/v/inbox.md" });
    await settle();
    emit("file:created", { isDir: false, origin: "app", path: "/v/new.md" });
    await settle();

    expect(synced()).toEqual([["/v/inbox.md"], ["/v/new.md"]]);
  });

  // 이것을 실패시키는 것: 경로 하나인 flush 도 `invalidate()` 로 올린다(#791 의 self-save 판정이
  // 저장 메아리마다 mention 검색을 다시 부른다).
  it("names the one path of a single-path flush on the bump", async () => {
    renderHook(() => useLinkIndexWatcher());
    await settle();

    emit("file:changed", { mtime: 1, origin: "app", path: "/v/a.md" });
    await settle();

    expect(version()).toBe(1);
    expect(useLinkStore.getState().savedPath).toBe("/v/a.md");
  });

  // 이것을 실패시키는 것: `if (applied === 0) return;` 을 지운다.
  it("does not bump indexVersion when no path reached an index", async () => {
    syncWatchedPaths.mockResolvedValue({ applied: 0, failed: [] });
    renderHook(() => useLinkIndexWatcher());
    await settle();

    emit("file:changed", {
      mtime: 1,
      origin: "external",
      path: "/v/.DS_Store",
    });
    await settle();

    expect(syncWatchedPaths).toHaveBeenCalledTimes(1);
    expect(version()).toBe(0);
  });

  // 이것을 실패시키는 것: `chain = chain.then(flush)` 대신 `void flush()` 로 바로 부른다.
  it("runs one flush at a time", async () => {
    let release = (): void => {};
    syncWatchedPaths.mockImplementationOnce(
      (paths: string[]) =>
        new Promise((resolve) => {
          release = () => resolve({ applied: paths.length, failed: [] });
        }),
    );
    renderHook(() => useLinkIndexWatcher());
    await settle();

    emit("file:changed", { mtime: 1, origin: "external", path: "/v/a.md" });
    await settle();
    emit("file:changed", { mtime: 2, origin: "external", path: "/v/b.md" });
    await settle();
    // 첫 sync 가 끝나지 않았으니 둘째는 기다린다.
    expect(syncWatchedPaths).toHaveBeenCalledTimes(1);

    await act(async () => release());
    await settle();
    expect(synced()).toEqual([["/v/a.md"], ["/v/b.md"]]);
  });

  // 이것을 실패시키는 것: 실패한 경로를 다시 `schedule` 하지 않는다 — 또는 `retried` 를 보지 않고
  // 언제나 다시 넣는다(실패가 계속되면 끝없이 돈다).
  it("retries a failed path once, then drops it", async () => {
    syncWatchedPaths.mockImplementation(async (paths: string[]) => ({
      applied: paths.length,
      failed: paths.filter((p) => p === "/v/bad.md"),
    }));
    renderHook(() => useLinkIndexWatcher());
    await settle();

    emit("file:changed", { mtime: 1, origin: "external", path: "/v/bad.md" });
    emit("file:changed", { mtime: 1, origin: "external", path: "/v/ok.md" });
    await settle();
    await settle();
    await settle();

    expect(synced()).toEqual([["/v/bad.md", "/v/ok.md"], ["/v/bad.md"]]);
  });

  // 이것을 실패시키는 것: 성공한 경로를 `retried` 에서 빼지 않는다 — 한 번 실패했다 살아난 경로가
  // 다음 실패에서 재시도 없이 버려진다.
  it("gives a path that recovered a fresh retry on its next failure", async () => {
    const outcomes = [true, false, true, false];
    syncWatchedPaths.mockImplementation(async (paths: string[]) => ({
      applied: paths.length,
      failed: outcomes.shift() ? paths : [],
    }));
    renderHook(() => useLinkIndexWatcher());
    await settle();

    emit("file:changed", { mtime: 1, origin: "external", path: "/v/a.md" });
    await settle(); // 실패
    await settle(); // 재시도 성공
    emit("file:changed", { mtime: 2, origin: "external", path: "/v/a.md" });
    await settle(); // 실패
    await settle(); // 다시 한 번 재시도

    expect(syncWatchedPaths).toHaveBeenCalledTimes(4);
  });

  it("treats a rejected sync as every path failed", async () => {
    syncWatchedPaths.mockRejectedValueOnce(new Error("ipc"));
    renderHook(() => useLinkIndexWatcher());
    await settle();

    emit("file:changed", { mtime: 1, origin: "external", path: "/v/a.md" });
    await settle();
    await settle();

    expect(synced()).toEqual([["/v/a.md"], ["/v/a.md"]]);
    expect(version()).toBe(1);
  });

  // 이것을 실패시키는 것: 일부 `listen` 이 실패했을 때 이미 등록된 리스너를 풀지 않는다.
  it("unlistens the registered listeners when another one fails to register", async () => {
    vi.mocked(listen).mockImplementation(async (event, handler) => {
      if (event === "file:deleted") throw new Error("listen");
      handlers.set(event, handler as (e: { payload: unknown }) => void);
      return () => {
        unlistened.push(event);
      };
    });
    renderHook(() => useLinkIndexWatcher());
    await settle();

    expect(unlistened.sort()).toEqual(["file:changed", "file:created"]);
  });
});
