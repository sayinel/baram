// §3.2 issue 797 — a reload keeps the window, so no `Destroyed` gives back what the
// previous page held, and its cleanups need not run. The page gives it back itself,
// once, before it watches anything, and every watch it asks for carries the page's
// number so one the earlier page still had in flight is refused.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { args?: Record<string, unknown>; cmd: string }[] = [];
let resetFails = false;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ args, cmd });
    if (cmd === "release_window_watches") {
      if (resetFails) throw new Error("ipc down");
      return 7;
    }
    return cmd === "watch_dir" ? calls.length : undefined;
  }),
}));

beforeEach(() => {
  calls.length = 0;
  resetFails = false;
  vi.resetModules();
});

const cmds = (): string[] => calls.map((c) => c.cmd);

describe("watchDir on a fresh page", () => {
  // 이것을 실패시키는 것: `watchDir` 가 `beginPage` 를 기다리지 않는다 — 또는 page 를 싣지 않는다.
  it("gives back the window's earlier leases once, before its first watch, and carries the page", async () => {
    const { watchDir } = await import("../fs");
    await watchDir("/v");
    await watchDir("/w", { focus: "/w/a.md", recursive: false });
    expect(cmds()).toEqual([
      "release_window_watches",
      "watch_dir",
      "watch_dir",
    ]);
    expect(calls.slice(1).map((c) => c.args?.page)).toEqual([7, 7]);
  });

  // A reload is a new module instance: it resets again.
  it("does it again on the next page load", async () => {
    await (await import("../fs")).watchDir("/v");
    vi.resetModules();
    await (await import("../fs")).watchDir("/v");
    expect(cmds().filter((c) => c === "release_window_watches")).toHaveLength(
      2,
    );
  });

  // 이것을 실패시키는 것: 실패한 reset 을 캐시해 이 page 가 끝내 감시하지 못한다.
  it("asks for the page again after a failed reset", async () => {
    const { watchDir } = await import("../fs");
    resetFails = true;
    await expect(watchDir("/v")).rejects.toThrow("ipc down");
    resetFails = false;
    await watchDir("/v");
    expect(cmds()).toEqual([
      "release_window_watches",
      "release_window_watches",
      "watch_dir",
    ]);
  });
});

describe("watchRefusal", () => {
  // 이것을 실패시키는 것: 접두어를 `watch_registry.rs` 의 상수와 다르게 읽는다.
  it("reads the prefix Rust puts on a refusal", async () => {
    const { watchRefusal } = await import("../fs");
    expect(watchRefusal("watch-capacity: 128 folders")).toBe("capacity");
    expect(watchRefusal("watch-unauthorized: /x")).toBe("unauthorized");
    expect(watchRefusal("watch-stale-page: main")).toBe("stale");
    expect(watchRefusal(new Error("could not watch /x"))).toBe("other");
  });
});
