// §3.2 issue 797 — a reload keeps the window, so no `Destroyed` gives back what the
// previous page held, and its cleanups need not run. The page gives it back itself,
// once, before it watches anything.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    calls.push(cmd);
    return cmd === "watch_dir" ? calls.length : undefined;
  }),
}));

beforeEach(() => {
  calls.length = 0;
  vi.resetModules();
});

describe("watchDir on a fresh page", () => {
  // 이것을 실패시키는 것: `watchDir` 가 `releasePreviousPageWatches` 를 기다리지 않는다.
  it("gives back the window's earlier leases once, before its first watch", async () => {
    const { watchDir } = await import("../fs");
    await watchDir("/v");
    await watchDir("/w", { focus: "/w/a.md", recursive: false });
    expect(calls).toEqual(["release_window_watches", "watch_dir", "watch_dir"]);
  });

  // A reload is a new module instance: it resets again.
  it("does it again on the next page load", async () => {
    await (await import("../fs")).watchDir("/v");
    vi.resetModules();
    await (await import("../fs")).watchDir("/v");
    expect(calls.filter((c) => c === "release_window_watches")).toHaveLength(2);
  });
});
