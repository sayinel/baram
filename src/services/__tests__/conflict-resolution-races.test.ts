/*
 * §3.6 충돌 동작의 수명 — 실행 토큰, 경로 묶기, 쓰기 뒤 확인과 인정.
 *
 * 버튼은 동작이 도는 동안 비활성이라 UI 로는 동시 호출을 만들 수 없다. 여기서는
 * `conflict-resolution.ts` 를 직접 부르고, 외부 변경은 진짜 워처 핸들러로 넣는다.
 * 장면은 `components/layout/__tests__/conflict-scene.ts` 의 S 다.
 */
import type { ConflictEntry } from "../../stores/ui/conflict-queue";

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ChangedHandler = (e: {
  payload: { mtime: number; origin?: string; path: string };
}) => void;
let onFileChanged: ChangedHandler | null = null;

vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: unknown) => {
    if (name === "file:changed") onFileChanged = handler as ChangedHandler;
    return Promise.resolve(() => undefined);
  },
}));

const io = vi.hoisted(() => ({
  mergeTexts: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  readFile: (path: string) => io.readFile(path),
  updateFileIndex: () => Promise.resolve(),
  watchDir: () => Promise.resolve(),
  writeFile: (path: string, content: string) => io.writeFile(path, content),
}));

vi.mock("../../ipc/snapshot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/snapshot")>()),
  mergeTexts: (base: string, local: string, external: string) =>
    io.mergeTexts(base, local, external),
}));

import {
  A,
  A2,
  cacheTab,
  deferred,
  disk,
  isDirty,
  NOW,
  queueIds,
  setupScene,
  teardownScene,
} from "../../components/layout/__tests__/conflict-scene";
import { useConflictTargetSync } from "../../components/layout/use-conflict-actions";
import { shouldDeferSave } from "../../hooks/use-auto-save";
import { useFileWatcher } from "../../hooks/use-file-watcher";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useUIStore } from "../../stores/ui/ui";
import {
  applyConflictMerge,
  keepLocalForConflict,
  prepareConflictMerge,
} from "../conflict-resolution";

const MERGED = "MERGED\n";

function event(path: string, mtime: number, origin = "external") {
  act(() => {
    onFileChanged!({ payload: { mtime, origin, path } });
  });
}

const entryOf = (tabId: string): ConflictEntry =>
  useUIStore.getState().conflictQueue.find((e) => e.tabId === tabId)!;

const guard = (path: string) =>
  shouldDeferSave(useFileStore.getState().getFileMtime(path));

async function mountWithConflictOnA() {
  const h = renderHook(() => {
    useFileWatcher();
    useConflictTargetSync();
  });
  await waitFor(() => expect(onFileChanged).not.toBeNull());
  event(A, 2000);
  return h;
}

/** Merge ready for Apply: prepared against EXT1 and "A local". */
async function prepared() {
  const r = await prepareConflictMerge(entryOf("a"));
  if (r.code !== "prepared") throw new Error(`prepare: ${r.code}`);
  return r.prepared;
}

function rename(from: string, to: string) {
  act(() => {
    useFileStore.getState().renameFileEntry(from, to, to.split("/").pop()!);
    useEditorStore.getState().renameTab(from, to, to.split("/").pop()!);
  });
}

beforeEach(() => {
  onFileChanged = null;
  setupScene();
  io.readFile.mockReset();
  io.readFile.mockImplementation(async (path: string) => {
    if (!disk.has(path)) throw new Error(`ENOENT ${path}`);
    return disk.get(path)!;
  });
  io.writeFile.mockReset();
  io.writeFile.mockImplementation(async (path: string, content: string) => {
    disk.set(path, content);
  });
  io.mergeTexts.mockReset();
  io.mergeTexts.mockResolvedValue({ segments: [] });
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  teardownScene();
});

describe("§3.6 one action at a time, each with its own token", () => {
  it("g: a second Merge while the first reads is busy", async () => {
    // 이것을 실패시키는 것: `beginOp` 의 진행 중 거부 제거.
    await mountWithConflictOnA();
    const read = deferred<string>();
    io.readFile.mockReturnValueOnce(read.promise);

    const first = prepareConflictMerge(entryOf("a"));
    const second = await prepareConflictMerge(entryOf("a"));
    read.resolve("EXT1\n");
    await first;

    expect(second.code).toBe("busy");
    expect(io.readFile).toHaveBeenCalledTimes(1);
    expect(io.mergeTexts).toHaveBeenCalledTimes(1);
  });

  it("v: Apply takes its own token after Merge released its own", async () => {
    // 이것을 실패시키는 것: Apply 가 새 토큰을 잡지 않고 준비의 토큰으로 판정(언제나 거짓).
    await mountWithConflictOnA();

    const result = await applyConflictMerge(await prepared(), MERGED);

    expect(result.code).toBe("applied");
    expect(io.writeFile).toHaveBeenCalledTimes(1);
    expect(isDirty("a")).toBe(false);
    expect(queueIds()).toEqual([]);
  });

  it("w: a second Apply while the first writes is busy", async () => {
    // 이것을 실패시키는 것: `beginOp` 의 진행 중 거부 제거.
    await mountWithConflictOnA();
    const p = await prepared();
    const write = deferred<void>();
    io.writeFile.mockImplementationOnce(async (path: string, c: string) => {
      await write.promise;
      disk.set(path, c);
    });

    const first = applyConflictMerge(p, MERGED);
    await Promise.resolve();
    await Promise.resolve();
    const second = await applyConflictMerge(p, MERGED);
    write.resolve();
    await first;

    expect(second.code).toBe("busy");
    expect(io.writeFile).toHaveBeenCalledTimes(1);
  });
});

describe("§3.6 an action is bound to the tab's path", () => {
  it("x: a rename while Merge reads stops it; the next Merge reads the new path", async () => {
    // 이것을 실패시키는 것: `liveness` 의 경로 비교 제거.
    await mountWithConflictOnA();
    const read = deferred<string>();
    io.readFile.mockReturnValueOnce(read.promise);

    const pending = prepareConflictMerge(entryOf("a"));
    await Promise.resolve();
    await Promise.resolve();
    rename(A, A2);
    disk.set(A2, "EXT1\n");
    read.resolve("EXT1\n");

    expect((await pending).code).toBe("path-changed");
    expect(entryOf("a").filePath).toBe(A2);
    io.readFile.mockClear();
    expect((await prepareConflictMerge(entryOf("a"))).code).toBe("prepared");
    expect(io.readFile).toHaveBeenCalledWith(A2);
  });

  it("y: a rename between Merge and Apply stops Apply before any write", async () => {
    // 옛 경로에 다른 파일이 같은 내용으로 생겼다 — 디스크 확인으로는 구별되지 않는다.
    // 이것을 실패시키는 것: `beginOp` 직후 경로 비교 제거(Apply 의 토큰은 탭의 지금 경로 a2 에
    // 묶이므로, 옛 이름에 대한 동의로 새 경로 a2 를 읽고 그대로 쓴다).
    await mountWithConflictOnA();
    const p = await prepared();
    rename(A, A2);
    disk.set(A, "EXT1\n");
    disk.set(A2, "EXT1\n");
    io.readFile.mockClear();

    const result = await applyConflictMerge(p, MERGED);

    expect(result.code).toBe("path-changed");
    expect(io.writeFile).not.toHaveBeenCalled();
    expect(io.readFile).not.toHaveBeenCalled();
  });

  it("y2: a rename during Apply's disk check stops it before the write", async () => {
    // 이것을 실패시키는 것: 사전 디스크 확인 뒤 `liveness` 제거.
    await mountWithConflictOnA();
    const p = await prepared();
    const read = deferred<string>();
    io.readFile.mockReturnValueOnce(read.promise);

    const pending = applyConflictMerge(p, MERGED);
    await Promise.resolve();
    await Promise.resolve();
    rename(A, A2);
    read.resolve("EXT1\n");

    expect((await pending).code).toBe("path-changed");
    expect(io.writeFile).not.toHaveBeenCalled();
  });
});

describe("§3.6 the first await is checked too", () => {
  it("a tab closed while Merge waits for block ID renames is not activated", async () => {
    // 닫힌 탭 id 로 `setActiveTab` 하면 활성 탭이 없는 탭을 가리킨다.
    // 이것을 실패시키는 것: prepare 의 `awaitBlockIdRenames` 뒤 `liveness` 제거.
    await mountWithConflictOnA();
    const pending = prepareConflictMerge(entryOf("a"));
    act(() => useEditorStore.getState().closeTab("a"));

    expect((await pending).code).toBe("tab-gone");
    expect(useEditorStore.getState().activeTabId).toBe("b");
  });

  it("a rename as Keep Local starts writes nothing to the old path", async () => {
    // 이것을 실패시키는 것: keep-local 의 `awaitBlockIdRenames` 뒤 `liveness` 제거(옛 경로에 쓴다).
    await mountWithConflictOnA();
    const pending = keepLocalForConflict(entryOf("a"));
    rename(A, A2);

    expect((await pending).code).toBe("path-changed");
    expect(io.writeFile).not.toHaveBeenCalled();
  });
});

describe("§3.6 a write is acknowledged only once the file is seen to hold it", () => {
  it("j: an external write during ours is not acknowledged", async () => {
    // 이것을 실패시키는 것: 사후 확인 제거(쓰고 나면 무조건 인정·adopt).
    await mountWithConflictOnA();
    const p = await prepared();
    const write = deferred<void>();
    io.writeFile.mockImplementationOnce(async (path: string, c: string) => {
      await write.promise;
      disk.set(path, c);
      disk.set(path, "EXT3\n"); // 우리 쓰기 직후 남이 덮었다.
    });

    const pending = applyConflictMerge(p, MERGED);
    await Promise.resolve();
    await Promise.resolve();
    event(A, 5000);
    write.resolve();

    expect((await pending).code).toBe("superseded");
    expect(isDirty("a")).toBe(true);
    expect(useFileStore.getState().openFiles.get(A)).toBe("A local\n");
    expect(queueIds()).toEqual(["a"]);
    expect(guard(A)).toBe(true);
  });

  it("j2a: the echo cutoff is the time observed, never a future pending mtime", async () => {
    // 이것을 실패시키는 것: `lastSaveMtime = max(now, canReloadMtime)`(4100 이 걸러진다) /
    // 인정(`canReloadMtime = 0`) 제거(9e12 > 4000 이라 가드가 남는다).
    await mountWithConflictOnA();
    useFileStore.getState().updateCanReloadMtime(A, 9_000_000_000_000);
    const p = await prepared();

    expect((await applyConflictMerge(p, MERGED)).code).toBe("applied");
    expect(queueIds()).toEqual([]);
    expect(isDirty("a")).toBe(false);
    expect(useFileStore.getState().getFileMtime(A)).toEqual({
      canReloadMtime: 0,
      lastSaveMtime: NOW,
    });
    expect(guard(A)).toBe(false);

    io.readFile.mockClear();
    event(A, 4100);
    await waitFor(() => expect(io.readFile).toHaveBeenCalledWith(A));
  });

  it("j2b: our own echo during the write is acknowledged with the write", async () => {
    // 이것을 실패시키는 것: `resolveConflict(tabId, 동작 시작 generation)`(echo 가 올린 generation
    // 때문에 항목이 남는다).
    await mountWithConflictOnA();
    const p = await prepared();
    const write = deferred<void>();
    io.writeFile.mockImplementationOnce(async (path: string, c: string) => {
      await write.promise;
      disk.set(path, c);
    });

    const pending = applyConflictMerge(p, MERGED);
    await Promise.resolve();
    await Promise.resolve();
    event(A, 3990, "app");
    write.resolve();

    expect((await pending).code).toBe("applied");
    expect(queueIds()).toEqual([]);
    io.readFile.mockClear();
    event(A, 3990, "app");
    await Promise.resolve();
    expect(io.readFile).not.toHaveBeenCalled();
    expect(queueIds()).toEqual([]);
  });

  it("j3: an event during the check makes it read again; a changed file is not acknowledged", async () => {
    // 이것을 실패시키는 것: g0 비교 제거(첫 읽기로 인정한다).
    await mountWithConflictOnA();
    const p = await prepared();
    const check = deferred<string>();
    // 사전 확인은 EXT1 을 그대로 읽고, 사후 첫 읽기를 붙든다.
    io.readFile
      .mockImplementationOnce(async () => "EXT1\n")
      .mockReturnValueOnce(check.promise);

    const pending = applyConflictMerge(p, MERGED);
    await waitFor(() => expect(io.readFile).toHaveBeenCalledTimes(2));
    disk.set(A, "EXT3\n");
    event(A, 5000);
    const generation = entryOf("a").generation;
    check.resolve(MERGED);

    expect((await pending).code).toBe("superseded");
    expect(isDirty("a")).toBe(true);
    expect(entryOf("a").generation).toBe(generation);
    expect(guard(A)).toBe(true);
  });

  it("j4: when the second read still holds our text, it is acknowledged", async () => {
    // 이것을 실패시키는 것: 다시 읽기 대신 바로 `unstable`.
    await mountWithConflictOnA();
    const p = await prepared();
    const check = deferred<string>();
    io.readFile
      .mockImplementationOnce(async () => "EXT1\n")
      .mockReturnValueOnce(check.promise);

    const pending = applyConflictMerge(p, MERGED);
    await waitFor(() => expect(io.readFile).toHaveBeenCalledTimes(2));
    event(A, 5000);
    check.resolve(MERGED);

    expect((await pending).code).toBe("applied");
    expect(queueIds()).toEqual([]);
  });

  it("text that changed during the write is not adopted; the conflict comes back against it", async () => {
    // 이것을 실패시키는 것: 인정 직전의 local 재확인 제거(쓰는 사이 바뀐 local 이 clean 으로 덮인다).
    await mountWithConflictOnA();
    const p = await prepared();
    const write = deferred<void>();
    io.writeFile.mockImplementationOnce(async (path: string, c: string) => {
      await write.promise;
      disk.set(path, c);
    });

    const pending = applyConflictMerge(p, MERGED);
    await Promise.resolve();
    await Promise.resolve();
    cacheTab("a", "<p>A local 2</p>");
    write.resolve();

    expect((await pending).code).toBe("local-changed");
    expect(isDirty("a")).toBe(true);
    expect(entryOf("a").base).toBe("A local\n");
    expect(guard(A)).toBe(true);
  });

  it("a tab that lost its live view during the write is not acknowledged", async () => {
    // a 가 쓰는 사이 활성이 됐지만 shared editor 에는 아직 b 가 있다 — 설치할 자리가 없다.
    // 이것을 실패시키는 것: 인정 직전의 `adoptable` 재확인 제거(인정하고 resolve 하지만 adopt 는
    // 아무것도 하지 않아 탭은 dirty, 가드는 풀린 채 남는다).
    await mountWithConflictOnA();
    const p = await prepared();
    const write = deferred<void>();
    io.writeFile.mockImplementationOnce(async (path: string, c: string) => {
      await write.promise;
      disk.set(path, c);
    });

    const pending = applyConflictMerge(p, MERGED);
    await Promise.resolve();
    await Promise.resolve();
    useEditorStore.setState({ activeTabId: "a" });
    write.resolve();

    expect((await pending).code).toBe("local-changed");
    expect(queueIds()).toEqual(["a"]);
    expect(guard(A)).toBe(true);
  });

  it("a file that keeps changing during the check gives up as unstable", async () => {
    // 이것을 실패시키는 것: 다시 읽기 횟수 상한 제거(끝나지 않는다) — 상한은 3 회.
    await mountWithConflictOnA();
    const p = await prepared();
    let reads = 0;
    io.readFile.mockImplementation(async (path: string) => {
      reads += 1;
      // 사전 확인(1회째) 뒤의 읽기마다 새 이벤트가 끼어든다.
      if (reads > 1) event(A, 5000 + reads);
      return disk.get(path)!;
    });

    expect((await applyConflictMerge(p, MERGED)).code).toBe("unstable");
    expect(reads).toBe(1 + 3);
    expect(guard(A)).toBe(true);
  });
});
