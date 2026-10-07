// §3.2 issue 797 — the watches the main window takes and gives back. The IPC double
// keeps the live leases, so each case counts what is still held.
import { StrictMode } from "react";

import { act, render, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Live leases: id → [path, options]. */
const live = new Map<number, [string, Record<string, unknown>]>();
let nextLease = 1;
const watchDir = vi.fn(
  async (path: string, options: Record<string, unknown> = {}) => {
    const id = nextLease++;
    live.set(id, [path, options]);
    return id;
  },
);
const unwatchDir = vi.fn(async (id: number) => {
  live.delete(id);
});
const setOpenFiles = vi.fn(async () => {});
// The watch service asks through `ipc/fs`; refusals are read the real way.
vi.mock("../../ipc/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/fs")>()),
  unwatchDir: (id: number) => unwatchDir(id),
  watchDir: (path: string, options?: Record<string, unknown>) =>
    watchDir(path, options),
}));
const handlers = new Map<string, () => void>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: () => void) => {
    handlers.set(event, handler);
    return () => handlers.delete(event);
  }),
}));
vi.mock("../../ipc/invoke", () => ({
  // tauri-storage(store 영속화)가 ipc/invoke 재export 로 부른다
  getConfig: vi.fn(async () => null),
  setConfig: vi.fn(async () => {}),
  setOpenFiles: () => setOpenFiles(),
  unwatchDir: (id: number) => unwatchDir(id),
  watchDir: (path: string, options?: Record<string, unknown>) =>
    watchDir(path, options),
}));

import type { ContextInfo } from "../../ipc/types";

import { useWatchStatusStore } from "../../services/watch-leases";
import { useContextStore } from "../../stores/context/context";
import { useWatchLeases } from "../use-watch-leases";

function context(path: string): ContextInfo {
  return { contextType: "vault", id: path, path } as ContextInfo;
}

const OPEN_ONE = ["/out/x.md"];

function livePaths(): string[] {
  return [...live.values()].map(([path]) => path).sort();
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  live.clear();
  nextLease = 1;
  watchDir
    .mockReset()
    .mockImplementation(
      async (path: string, options: Record<string, unknown> = {}) => {
        const id = nextLease++;
        live.set(id, [path, options]);
        return id;
      },
    );
  unwatchDir.mockClear();
  setOpenFiles.mockClear();
  useContextStore.setState({ contexts: [context("/a"), context("/b")] });
});

describe("useWatchLeases", () => {
  // 이것을 실패시키는 것: 바깥 파일 탭이 닫혀도 그 watch 를 `release` 하지 않는다 — 또는 unmount 에서 돌려주지 않는다.
  it("holds nothing after a hundred rounds of opening and closing", async () => {
    const hook = renderHook(
      ({ root, open }: { open: string[]; root: null | string }) =>
        useWatchLeases(root, open),
      { initialProps: { open: [] as string[], root: "/a" as null | string } },
    );
    for (let i = 0; i < 100; i++) {
      hook.rerender({ open: [`/out/${i}.md`, "/a/n.md"], root: "/a" });
      await settle();
      hook.rerender({ open: [], root: "/a" });
      await settle();
    }
    expect(livePaths()).toEqual(["/a"]);
    hook.unmount();
    await settle();
    expect(live.size).toBe(0);
  });

  // 이것을 실패시키는 것: 활성 root 가 바뀔 때 이전 root 의 lease 를 돌려준다.
  it("keeps a vault visited earlier watched, and gives it back when its context is removed", async () => {
    const hook = renderHook(
      ({ root }: { root: string }) => useWatchLeases(root, []),
      { initialProps: { root: "/a" } },
    );
    await settle();
    hook.rerender({ root: "/b" });
    await settle();
    expect(livePaths()).toEqual(["/a", "/b"]);
    // 이것을 실패시키는 것: context 가 제거되어도 그 root 의 lease 를 돌려주지 않는다.
    await act(async () => {
      useContextStore.setState({ contexts: [context("/b")] });
    });
    await settle();
    expect(livePaths()).toEqual(["/b"]);
    hook.unmount();
  });

  // 이것을 실패시키는 것: 바깥 파일의 폴더를 재귀로, focus 없이 건다.
  it("watches an out-of-vault file's folder non-recursively for that file", async () => {
    const hook = renderHook(() => useWatchLeases("/a", ["/home/u/note.md"]));
    await settle();
    expect(watchDir).toHaveBeenCalledWith("/home/u", {
      focus: "/home/u/note.md",
      recursive: false,
    });
    hook.unmount();
  });

  // 이것을 실패시키는 것: 파일이 아니라 폴더마다 lease 를 하나만 두고, 탭 하나가 닫히면 그것을 돌려준다.
  it("gives back one of two tabs' leases on one folder without touching the other", async () => {
    const hook = renderHook(
      ({ open }: { open: string[] }) => useWatchLeases("/a", open),
      { initialProps: { open: ["/out/x.md", "/out/y.md"] } },
    );
    await settle();
    expect(livePaths()).toEqual(["/a", "/out", "/out"]);
    hook.rerender({ open: ["/out/y.md"] });
    await settle();
    expect(livePaths()).toEqual(["/a", "/out"]);
    expect([...live.values()].some(([, o]) => o.focus === "/out/y.md")).toBe(
      true,
    );
    hook.unmount();
  });

  // 이것을 실패시키는 것: unmount cleanup 이 맵을 비우지 않아 StrictMode 의 두 번째 mount 가 다시 걸지
  // 않는다 — 또는 cleanup 이 첫 mount 의 lease 를 돌려주지 않는다.
  it("holds exactly one lease per watch under StrictMode's double effects", async () => {
    function Host() {
      useWatchLeases("/a", OPEN_ONE);
      return null;
    }
    const view = render(
      <StrictMode>
        <Host />
      </StrictMode>,
    );
    await settle();
    // The effects did run twice (the open set sent per mount, plus the second mount's
    // root watch registering it first) — and the first mount's watches, released
    // before they were asked for, were never taken.
    expect(setOpenFiles).toHaveBeenCalledTimes(3);
    expect(watchDir).toHaveBeenCalledTimes(2);
    expect(livePaths()).toEqual(["/a", "/out"]);
    view.unmount();
  });

  // A refused watch stays wanted and shown until Rust says it may succeed (#797).
  // 이것을 실패시키는 것: 거부된 watch 를 버린다 — 또는 `watch:retry` 에 다시 묻지 않는다.
  it("keeps a watch refused at the cap queued and shown, and takes it on retry", async () => {
    watchDir.mockRejectedValueOnce(
      "watch-capacity: 128 folders are already watched",
    );
    const hook = renderHook(() => useWatchLeases(null, OPEN_ONE));
    await settle();
    expect(livePaths()).toEqual([]);
    expect(useWatchStatusStore.getState().queued.capacity).toBe(1);
    await act(async () => {
      handlers.get("watch:retry")?.();
    });
    await settle();
    expect(livePaths()).toEqual(["/out"]);
    expect(useWatchStatusStore.getState().queued.capacity).toBe(0);
    hook.unmount();
  });

  // On Windows a path's folders are split by `\`, and a drive path compares without
  // case. 이것을 실패시키는 것: 폴더를 `/` 로만 나눈다(`parentDir`) — 또는 root 아래를
  // `startsWith(root + "/")` 로 판정한다.
  it("watches the folder of a drive or UNC file, and not a file under the active root", async () => {
    const hook = renderHook(() =>
      useWatchLeases("C:\\Vault", [
        "D:\\Notes\\a.md",
        "\\\\server\\share\\b.md",
        "c:\\vault\\inside.md",
      ]),
    );
    await settle();
    expect(watchDir).toHaveBeenCalledWith("D:\\Notes", {
      focus: "D:\\Notes\\a.md",
      recursive: false,
    });
    expect(watchDir).toHaveBeenCalledWith("\\\\server\\share", {
      focus: "\\\\server\\share\\b.md",
      recursive: false,
    });
    expect(
      watchDir.mock.calls.some(([, o]) => o?.focus === "c:\\vault\\inside.md"),
    ).toBe(false);
    hook.unmount();
  });
});
