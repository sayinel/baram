// §3.2 issue 797 — a wanted watch is held, or queued and shown; never dropped while
// wanted. The IPC double counts requests and keeps the live leases.
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const live = new Set<number>();
let nextLease = 1;
const take = async (): Promise<number> => {
  const id = nextLease++;
  live.add(id);
  return id;
};
const watchDir = vi.fn(take);
const unwatchDir = vi.fn(async (id: number) => {
  live.delete(id);
});
vi.mock("../../ipc/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/fs")>()),
  unwatchDir: (id: number) => unwatchDir(id),
  watchDir: () => watchDir(),
}));
const handlers = new Map<string, (e: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (event: string, handler: (e: { payload: unknown }) => void) => {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
  ),
}));

function fire(event: string, payload: unknown = null): Promise<void> {
  return act(async () => {
    handlers.get(event)?.({ payload });
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function load() {
  const service = await import("../watch-leases");
  const { WatchWarning } = await import("../../components/layout/WatchWarning");
  return { ...service, WatchWarning };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  handlers.clear();
  live.clear();
  nextLease = 1;
  watchDir.mockReset().mockImplementation(take);
  unwatchDir.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("watch-leases", () => {
  // 이것을 실패시키는 것: capacity 로 거부된 watch 를 버린다 — 또는 `watch:retry` 에 바로 다시 묻지 않는다 — 또는 경고가 할 일을 말하지 않는다.
  it("shows a watch refused at the cap and takes it once room is made", async () => {
    const { want, WatchWarning } = await load();
    watchDir.mockRejectedValueOnce(
      "watch-capacity: 128 folders are already watched",
    );
    render(<WatchWarning />);
    const handle = want("/out", { focus: "/out/x.md", recursive: false });
    await flush();
    // It says what to do: free a watch by closing other folders' tabs; it retries itself.
    expect(screen.getByRole("alert").textContent).toMatch(/1 folder watch/);
    expect(screen.getByRole("alert").textContent).toMatch(/Close tabs/);
    expect(watchDir).toHaveBeenCalledTimes(1);
    // A watcher stopped somewhere: room.
    await fire("watch:retry");
    expect(watchDir).toHaveBeenCalledTimes(2);
    expect(live.size).toBe(1);
    expect(screen.queryByRole("alert")).toBeNull();
    handle.release();
  });

  // 이것을 실패시키는 것: `watch:lease-ended` 를 듣지 않는다 — Rust 가 끝낸 lease 를 아직 쥔 줄 안다.
  it("asks again for a watch whose lease Rust ended", async () => {
    const { want } = await load();
    const handle = want("/v");
    await flush();
    expect(watchDir).toHaveBeenCalledTimes(1);
    await fire("watch:lease-ended", { lease: 1 });
    expect(watchDir).toHaveBeenCalledTimes(2);
    // Another lease's end is not this watch's.
    await fire("watch:lease-ended", { lease: 99 });
    expect(watchDir).toHaveBeenCalledTimes(2);
    handle.release();
    await flush();
    expect(unwatchDir).toHaveBeenCalledWith(2);
  });

  // 이것을 실패시키는 것: 몇 번 실패하면 watch 를 버린다(예전의 3회 상한).
  it("keeps asking for a watch refused for another reason, backing off, until it holds", async () => {
    const { useWatchStatusStore, want } = await load();
    for (let i = 0; i < 6; i++)
      watchDir.mockRejectedValueOnce(new Error("busy"));
    const handle = want("/v");
    await flush();
    expect(useWatchStatusStore.getState().queued.other).toBe(1);
    // 1 + 2 + 4 + 8 + 16 + 30 seconds.
    await flush(61_000);
    expect(watchDir).toHaveBeenCalledTimes(7);
    expect(live.size).toBe(1);
    expect(useWatchStatusStore.getState().queued.other).toBe(0);
    handle.release();
  });

  // A watched folder deleted and made again: its watch ended, the re-ask was refused
  // (the folder was gone), and nothing in Rust announces its return.
  // 이것을 실패시키는 것: 인가·용량 거부에는 backoff 를 걸지 않고 `watch:retry` 만 기다린다.
  it("takes again a watch refused while its folder was gone, without any event", async () => {
    const { useWatchStatusStore, want, WatchWarning } = await load();
    render(<WatchWarning />);
    const handle = want("/v");
    await flush();
    watchDir.mockRejectedValueOnce("watch-unauthorized: /v does not exist");
    live.delete(1);
    await fire("watch:lease-ended", { lease: 1 });
    expect(useWatchStatusStore.getState().queued.unauthorized).toBe(1);
    expect(screen.getByRole("alert").textContent).toMatch(/approve/);
    await flush(1_000);
    expect(watchDir).toHaveBeenCalledTimes(3);
    expect(live.size).toBe(1);
    expect(useWatchStatusStore.getState().queued.unauthorized).toBe(0);
    handle.release();
  });

  // 이것을 실패시키는 것: 응답 전에 release 된 watch 의 lease 를 돌려주지 않는다.
  it("gives back a lease that arrives after its watch was released", async () => {
    const { want } = await load();
    let answer: (id: number) => void = () => {};
    watchDir.mockImplementationOnce(
      () => new Promise<number>((resolve) => (answer = resolve)),
    );
    const handle = want("/v");
    await flush();
    handle.release();
    answer(41);
    await flush();
    expect(unwatchDir).toHaveBeenCalledWith(41);
  });
});
