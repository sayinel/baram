// §44 묶어 쓰는 persist storage — 구간마다 최신 값 하나만 직렬화해서 쓴다 (#800).
//
// 밑의 string storage 를 손으로 끝내는 promise 로 바꿔, 쓰기 횟수와 순서를 센다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCoalescingStorage } from "../coalescing-storage";

interface Write {
  finish: () => void;
  name: string;
  value: string;
}
const writes: Write[] = [];
const removes: string[] = [];
const backing = {
  getItem: vi.fn(async (_name: string) => null as null | string),
  removeItem: vi.fn(async (name: string) => {
    removes.push(name);
  }),
  setItem: vi.fn(
    (name: string, value: string) =>
      new Promise<void>((resolve) => {
        writes.push({ finish: resolve, name, value });
      }),
  ),
};

type S = { n: number };
const value = (n: number) => ({ state: { n }, version: 0 });

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  writes.length = 0;
  removes.length = 0;
  backing.setItem.mockClear();
});

afterEach(() => {
  for (const w of writes) w.finish();
  vi.useRealTimers();
});

describe("§44 coalescing persist storage (#800)", () => {
  // 이것을 실패시키는 것: setItem 이 값을 모아 두지 않고 바로 밑의 storage 에 쓰게 하면 100번 쓴다.
  // `if (timer === null)` 을 지우고 매번 timer 를 걸면 구간 안에서도 여러 번 쓴다.
  it("writes once, with the newest value, for 100 updates inside one interval", async () => {
    const storage = createCoalescingStorage<S>(backing, 250);
    const stringify = vi.spyOn(JSON, "stringify");
    for (let i = 1; i <= 100; i++) storage.setItem("k", value(i));
    expect(backing.setItem).not.toHaveBeenCalled();
    expect(stringify).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);

    expect(backing.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(writes[0].value)).toEqual(value(100));
    expect(stringify).toHaveBeenCalledTimes(1);
    stringify.mockRestore();
  });

  // 이것을 실패시키는 것: 새 setItem 이 timer 를 다시 걸게(debounce) 하면 쉼 없이 오는 갱신이 끝날
  // 때까지 한 번도 쓰지 않는다.
  it("keeps saving every interval while updates keep coming", async () => {
    const storage = createCoalescingStorage<S>(backing, 250);
    for (let t = 0; t < 1_000; t += 50) {
      storage.setItem("k", value(t));
      await vi.advanceTimersByTimeAsync(50);
      writes.at(-1)?.finish();
      await settle();
    }
    expect(backing.setItem).toHaveBeenCalledTimes(4);
  });

  // 이것을 실패시키는 것: flush 가 쓰지 않고 timer 에 맡기면(`enqueue(writePending)` 대신 아무것도 하지
  // 않으면) 구간이 지나기 전에는 쓰지 않는다. 남은 timer 는 빈 map 에서 울려 더 쓰지 않는다.
  it("flush writes at once, and the leftover timer writes nothing more", async () => {
    const storage = createCoalescingStorage<S>(backing, 250);
    storage.setItem("k", value(1));
    const flushed = storage.flush();
    await settle();
    expect(writes).toHaveLength(1);
    writes[0].finish();
    await flushed;

    await vi.advanceTimersByTimeAsync(500);
    expect(backing.setItem).toHaveBeenCalledTimes(1);
  });

  // 이것을 실패시키는 것: 쓰기를 줄 세우지 않고(enqueue 의 `chain.then`) 바로 부르면 둘째 쓰기가 첫째가
  // 끝나기 전에 시작한다. 쓰기를 시작할 때가 아니라 flush 를 부를 때 값을 잡아 두면 둘째가 최신 값을
  // 쓰지 않는다.
  it("starts a write only after the previous one settled, and writes the newest value then", async () => {
    const storage = createCoalescingStorage<S>(backing, 250);
    storage.setItem("k", value(1));
    void storage.flush();
    await settle();
    storage.setItem("k", value(2));
    void storage.flush();
    storage.setItem("k", value(3));
    await settle();
    expect(writes).toHaveLength(1);

    writes[0].finish();
    await settle();
    expect(writes).toHaveLength(2);
    expect(JSON.parse(writes[1].value)).toEqual(value(3));
  });

  // 이것을 실패시키는 것: flush 가 자기 drain 을 줄에 세우지 않고 앞 drain 만 기다리게 하면(`return chain`)
  // 앞 drain 이 쓰는 사이 들어온 B 가 디스크에 없는 채로 flush 가 끝난다.
  it("flush is a barrier for everything set before it is called", async () => {
    const storage = createCoalescingStorage<S>(backing, 250);
    storage.setItem("k", value(1));
    void storage.flush();
    await settle();
    storage.setItem("k", value(2));
    let resolved = false;
    const flushed = storage.flush().then(() => {
      resolved = true;
    });
    writes[0].finish();
    await settle();

    expect(resolved).toBe(false);
    expect(writes).toHaveLength(2);
    expect(JSON.parse(writes[1].value)).toEqual(value(2));
    writes[1].finish();
    await flushed;
    expect(resolved).toBe(true);
  });

  // 이것을 실패시키는 것: drain 이 쓰는 사이 들어온 값까지 쫓아 쓰게 하면(쓰기마다 map 을 다시 읽는 loop)
  // flush 가 그 값을 쓸 때까지 끝나지 않는다.
  it("flush does not wait for values that arrive after it was called", async () => {
    const storage = createCoalescingStorage<S>(backing, 250);
    storage.setItem("k", value(1));
    let resolved = false;
    const flushed = storage.flush().then(() => {
      resolved = true;
    });
    await settle();
    storage.setItem("k", value(2));
    writes[0].finish();
    await flushed;

    expect(resolved).toBe(true);
    expect(writes).toHaveLength(1);
    // 그 값은 새 구간에 쓰인다.
    await vi.advanceTimersByTimeAsync(250);
    expect(writes).toHaveLength(2);
    expect(JSON.parse(writes[1].value)).toEqual(value(2));
  });

  // 이것을 실패시키는 것: 위와 같은 loop 로 되돌리면 쓰기가 IPC 가 끝나는 대로 이어져 구간 수보다 훨씬 많아진다.
  it("writes about once per interval while a stream runs, whatever the write latency", async () => {
    const slow = {
      ...backing,
      setItem: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, 30);
          }),
      ),
    };
    const storage = createCoalescingStorage<S>(slow, 250);
    // 10 ms 마다 token 하나, 2,500 ms 동안 — 구간 10개.
    for (let t = 0; t < 2_500; t += 10) {
      storage.setItem("k", value(t));
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(slow.setItem.mock.calls.length).toBeGreaterThanOrEqual(9);
    expect(slow.setItem.mock.calls.length).toBeLessThanOrEqual(11);
  });

  // 이것을 실패시키는 것: enqueue 의 `.catch` 를 지우면 한 번의 실패가 줄을 끊어 다음 쓰기가 가지 않는다.
  it("keeps writing after a failed write", async () => {
    const failing = {
      ...backing,
      setItem: vi
        .fn()
        .mockRejectedValueOnce(new Error("disk"))
        .mockResolvedValue(undefined),
    };
    const storage = createCoalescingStorage<S>(failing, 250);
    storage.setItem("k", value(1));
    await storage.flush();
    storage.setItem("k", value(2));
    await storage.flush();
    expect(failing.setItem).toHaveBeenCalledTimes(2);
  });

  // 이것을 실패시키는 것: removeItem 에서 `pending.delete(name)` 을 지우면 지운 뒤에 옛 값이 다시 쓰인다.
  it("removing a key drops its pending value", async () => {
    const storage = createCoalescingStorage<S>(backing, 250);
    storage.setItem("k", value(1));
    await storage.removeItem("k");
    await vi.advanceTimersByTimeAsync(250);
    expect(removes).toEqual(["k"]);
    expect(backing.setItem).not.toHaveBeenCalled();
  });

  it("reads through to the backing storage", async () => {
    backing.getItem.mockResolvedValueOnce(JSON.stringify(value(7)));
    const storage = createCoalescingStorage<S>(backing, 250);
    expect(await storage.getItem("k")).toEqual(value(7));
    expect(await storage.getItem("k")).toBeNull();
  });

  // 이것을 실패시키는 것: flush 가 걸려 있던 timer 를 지우지 않으면, flush 뒤의 변경이 새 구간이 아니라 옛
  // timer 의 시각에 저장된다 — 옛 timer 가 남아 setItem 이 새 timer 를 걸지 못하기 때문이다.
  it("starts a fresh interval for the first change after a flush", async () => {
    const storage = createCoalescingStorage<S>(backing, 250);
    storage.setItem("k", value(1));
    await vi.advanceTimersByTimeAsync(200);
    void storage.flush();
    await settle();
    writes[0].finish();
    await settle();
    storage.setItem("k", value(2));

    await vi.advanceTimersByTimeAsync(100);
    expect(writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(150);
    expect(writes).toHaveLength(2);
  });
});
