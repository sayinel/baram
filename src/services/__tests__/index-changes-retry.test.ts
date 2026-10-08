// §29 #824 A failed `index:changed` subscription is retried, and the one that holds
// bumps once for what the window missed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (e: { payload: unknown }) => void>();
const listen = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({ listen }));

function fails(): void {
  listen.mockImplementationOnce(async () => {
    throw new Error("ipc not ready");
  });
}

function holds(): void {
  listen.mockImplementationOnce(
    async (event: string, handler: (e: { payload: unknown }) => void) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
  );
}

/** A fresh module, and the link store it bumps (`vi.resetModules` gives a new one). */
async function load() {
  const { useLinkStore } = await import("../../stores/editor/link");
  useLinkStore.setState({ indexVersion: 0, savedPath: null });
  const changes = await import("../index-changes");
  return {
    ...changes,
    version: () => useLinkStore.getState().indexVersion,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  handlers.clear();
  listen.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("index:changed subscription", () => {
  // 이것을 실패시키는 것: 거부된 구독을 `installed` 에 남겨 두고 다시 시도하지 않는다 — 또는 다시 붙은
  // 구독이 그 사이 놓친 것을 한 번 올리지 않는다.
  it("is retried after a rejection, then bumps once and follows events", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { RETRY_FIRST_MS, installIndexChanges, version } = await load();
    fails();
    fails();
    holds();
    await expect(installIndexChanges()).rejects.toThrow("ipc not ready");
    expect(handlers.size).toBe(0);
    await vi.advanceTimersByTimeAsync(RETRY_FIRST_MS);
    // The first retry fails too; the next waits twice as long.
    expect(listen).toHaveBeenCalledTimes(2);
    expect(handlers.size).toBe(0);
    await vi.advanceTimersByTimeAsync(RETRY_FIRST_MS);
    expect(listen).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RETRY_FIRST_MS);
    expect(listen).toHaveBeenCalledTimes(3);
    await installIndexChanges();
    expect(listen).toHaveBeenCalledTimes(3);
    // The catch-up bump for what was announced while nothing listened.
    expect(version()).toBe(1);
    handlers.get("index:changed")!({
      payload: { entries: [], rebuilt: ["/v"] },
    });
    expect(version()).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  // 이것을 실패시키는 것: 처음부터 붙은 구독에도 catch-up bump 를 올린다.
  it("does not bump when the first subscription holds", async () => {
    const { installIndexChanges, version } = await load();
    holds();
    await installIndexChanges();
    await installIndexChanges();
    expect(listen).toHaveBeenCalledTimes(1);
    expect(version()).toBe(0);
    handlers.get("index:changed")!({
      payload: { entries: [], rebuilt: ["/v"] },
    });
    expect(version()).toBe(1);
  });

  // 이것을 실패시키는 것: 재시도 타이머가 그 사이 붙은 구독을 보지 않고 또 구독한다.
  it("does not subscribe twice when a caller got there before the retry", async () => {
    const { RETRY_FIRST_MS, installIndexChanges, version } = await load();
    fails();
    holds();
    await expect(installIndexChanges()).rejects.toThrow("ipc not ready");
    await installIndexChanges();
    expect(listen).toHaveBeenCalledTimes(2);
    expect(version()).toBe(1);
    await vi.advanceTimersByTimeAsync(RETRY_FIRST_MS * 4);
    expect(listen).toHaveBeenCalledTimes(2);
  });

  // 이것을 실패시키는 것: 기다림을 상한 없이 두 배로 늘린다(8번째 재시도가 30초가 아니라 32초 뒤).
  it("waits at most thirty seconds between tries", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { installIndexChanges } = await load();
    for (let i = 0; i < 9; i++) fails();
    await expect(installIndexChanges()).rejects.toThrow("ipc not ready");
    // 250 + 500 + … + 16000: seven retries.
    await vi.advanceTimersByTimeAsync(31_750);
    expect(listen).toHaveBeenCalledTimes(8);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(listen).toHaveBeenCalledTimes(9);
  });
});
