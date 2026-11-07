// §3.5 외부 변경 리로드가 읽기를 기다리는 사이 탭이 닫히거나 다시 열리면, 늦게 끝난 리로드는 결과를
// 쓰지 않는다 (#798).
//
// 읽기를 손으로 끝내는 promise 로 바꿔 "읽기 → (닫기 · 다시 열기 · 다른 리로드) → 읽기 끝" 순서를 만든다.
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const disk = new Map<string, string>();
const pendingReads: {
  reject: (e: unknown) => void;
  resolve: (c: string) => void;
}[] = [];

vi.mock("../../ipc/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/fs")>()),
  readFile: async (path: string) => disk.get(path) ?? "",
}));
vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  readFile: () =>
    new Promise<string>((resolve, reject) => {
      pendingReads.push({ reject, resolve });
    }),
  updateFileIndex: () => Promise.resolve(),
}));
vi.mock("../../plugins/plugin-lifecycle", () => ({
  notifyFileOpen: vi.fn(),
  notifyFileSave: vi.fn(),
}));
vi.mock("../../services/vault-context-loader", () => ({
  openFolder: async () => undefined,
  switchContext: async () => undefined,
}));

import { useContextStore } from "../../stores/context/context";
import { startClosedTabRelease } from "../../stores/editor/closed-tab-release";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { openFileByPath } from "../../utils/open-file";
import { pendingReloadPaths, triggerAutoReload } from "../use-file-operations";

const NOTE = "/v/note.md";
let stop: () => void = () => undefined;

function closeAll() {
  act(() => useEditorStore.getState().closeAllTabs());
}

async function finishRead(index: number, content: string) {
  await act(async () => {
    pendingReads[index].resolve(content);
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(async () => {
  disk.clear();
  disk.set(NOTE, "v1");
  pendingReads.length = 0;
  useFileStore.setState({ fileMtimes: new Map(), openFiles: new Map() });
  useEditorStore.setState({ activeTabId: null, mruOrder: [], tabs: [] });
  useContextStore.setState({
    activeContextId: null,
    contexts: [],
    ensureFileContext: vi.fn(async () => ({ id: "ctx1" })),
  } as never);
  stop = startClosedTabRelease();
  await openFileByPath(NOTE);
});

afterEach(() => stop());

// 이것을 실패시키는 것: use-file-operations.ts 의 `ownerLeft` 판정을 지우면 첫 두 시험이 깨진다 —
// 닫은 파일의 원문이 되살아나고, 다시 연 탭의 내용이 옛 리로드로 덮인다.
describe("§3.5 an auto-reload that finishes after its tab closed (#798)", () => {
  it("brings nothing back when the tab closed meanwhile", async () => {
    const reload = triggerAutoReload(NOTE, 5_000);
    closeAll();
    await finishRead(0, "stale");
    await reload;

    expect(useFileStore.getState().openFiles.size).toBe(0);
    expect(useFileStore.getState().fileMtimes.size).toBe(0);
  });

  it("leaves a quick reopen's content alone", async () => {
    const reload = triggerAutoReload(NOTE, 5_000);
    closeAll();
    disk.set(NOTE, "fresh");
    await openFileByPath(NOTE);
    await finishRead(0, "stale");
    await reload;

    expect(useFileStore.getState().openFiles.get(NOTE)).toBe("fresh");
  });

  // 이것을 실패시키는 것: 읽기 뒤의 `reloadGenerations.get(filePath) !== generation` 조기 반환을 지우면
  // 먼저 시작해 늦게 끝난 리로드가 나중 리로드의 결과를 덮는다.
  it("keeps the newer of two overlapping reloads", async () => {
    const older = triggerAutoReload(NOTE, 5_000);
    const newer = triggerAutoReload(NOTE, 6_000);
    await finishRead(1, "newer");
    await finishRead(0, "older");
    await Promise.all([older, newer]);

    expect(useFileStore.getState().openFiles.get(NOTE)).toBe("newer");
  });

  // 이것을 실패시키는 것: 번호를 경로마다 1 부터 세게 하면(`(reloadGenerations.get(filePath) ?? 0) + 1`)
  // 앞 리로드가 끝나 항목을 지운 뒤 시작한 셋째가 첫째와 같은 번호를 받아, 첫째가 결과를 쓴다.
  it("does not let an old reload reuse a number after the path's entry was cleared", async () => {
    const first = triggerAutoReload(NOTE, 5_000);
    const second = triggerAutoReload(NOTE, 6_000);
    await finishRead(1, "second");
    await second;
    const third = triggerAutoReload(NOTE, 7_000);
    await finishRead(0, "first");
    await first;

    expect(useFileStore.getState().openFiles.get(NOTE)).toBe("second");
    await finishRead(2, "third");
    await third;
    expect(useFileStore.getState().openFiles.get(NOTE)).toBe("third");
  });

  // 이것을 실패시키는 것: `ownerLeft` 에서 `owners.size > 0 &&` 를 빼면 탭 없이 캐시에만 있던 항목이
  // 외부 변경을 받지 못한다.
  it("still refreshes a cache entry no tab was showing", async () => {
    closeAll();
    useFileStore.getState().setFileContent(NOTE, "cached without a tab");
    const reload = triggerAutoReload(NOTE, 5_000);
    await finishRead(0, "changed outside");
    await reload;

    expect(useFileStore.getState().openFiles.get(NOTE)).toBe("changed outside");
  });

  // 이것을 실패시키는 것: 읽기가 실패했을 때 그 경로의 항목을 지우는 catch 를 빼면 항목이 남는다.
  it("forgets the path when the read fails, and after a normal reload", async () => {
    const failing = triggerAutoReload(NOTE, 5_000);
    pendingReads[0].reject("gone");
    await expect(failing).rejects.toBe("gone");
    expect(pendingReloadPaths()).toBe(0);

    const ok = triggerAutoReload(NOTE, 6_000);
    expect(pendingReloadPaths()).toBe(1);
    await finishRead(1, "v2");
    await ok;
    expect(pendingReloadPaths()).toBe(0);
  });

  // 이것을 실패시키는 것: catch 의 `=== generation` 확인을 빼면 실패한 옛 리로드가 나중 리로드의 항목을
  // 지워, 나중 리로드가 자기 결과를 버린다.
  it("lets a newer reload apply when an older one fails", async () => {
    const older = triggerAutoReload(NOTE, 5_000);
    const newer = triggerAutoReload(NOTE, 6_000);
    pendingReads[0].reject("gone");
    await expect(older).rejects.toBe("gone");
    await finishRead(1, "newer");
    await newer;

    expect(useFileStore.getState().openFiles.get(NOTE)).toBe("newer");
  });
});
