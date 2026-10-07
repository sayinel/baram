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
vi.mock("../../ipc/invoke", () => ({
  // tauri-storage(store 영속화)가 ipc/invoke 재export 로 부른다
  getConfig: vi.fn(async () => null),
  setConfig: vi.fn(async () => {}),
  setOpenFiles: vi.fn(async () => {}),
  unwatchDir: (id: number) => unwatchDir(id),
  watchDir: (path: string, options?: Record<string, unknown>) =>
    watchDir(path, options),
}));

import type { ContextInfo } from "../../ipc/types";

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
  watchDir.mockClear();
  unwatchDir.mockClear();
  useContextStore.setState({ contexts: [context("/a"), context("/b")] });
});

describe("useWatchLeases", () => {
  // 이것을 실패시키는 것: 바깥 파일 탭이 닫혀도 그 lease 를 `give` 하지 않는다 — 또는 unmount 에서 돌려주지 않는다.
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
    // The effects did run twice — the count below is not a single mount's.
    expect(watchDir).toHaveBeenCalledTimes(4);
    expect(unwatchDir).toHaveBeenCalledTimes(2);
    expect(livePaths()).toEqual(["/a", "/out"]);
    view.unmount();
  });
});
