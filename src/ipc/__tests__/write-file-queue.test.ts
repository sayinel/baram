// §3.5 같은 경로의 쓰기는 시작한 순서대로 끝나고, 그 경로의 읽기는 진행 중인 쓰기를 기다린다 (#798).
//
// invoke 를 손으로 끝내는 promise 로 바꿔, 앞 쓰기가 끝나기 전에 뒤 쓰기가 Rust 로 가지 않는지를 센다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Call {
  args: Record<string, string>;
  cmd: string;
  reject: (e: unknown) => void;
  resolve: (v?: unknown) => void;
}
const calls: Call[] = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, string>) =>
    new Promise((resolve, reject) => {
      calls.push({ args, cmd, reject, resolve });
    }),
}));

import { pendingWritePaths, readFile, writeFile } from "../fs";

/** microtask 를 몇 번 돌려 queue 의 then 사슬이 진행하게 한다. */
async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  calls.length = 0;
});

afterEach(async () => {
  for (const c of calls) c.resolve();
  await flush();
});

// 이것을 실패시키는 것: fs.ts 의 writeFile 이 `previous.then(...)` 을 기다리지 않고 invoke 를 바로
// 부르게 되돌리면 첫 시험에서 두 쓰기가 함께 Rust 로 간다.
describe("§3.5 per-path write queue (#798)", () => {
  it("sends a second write to the same path only after the first settles", async () => {
    const first = writeFile("/v/a.md", "old");
    const second = writeFile("/v/a.md", "new");
    await flush();
    expect(calls.map((c) => c.args.content)).toEqual(["old"]);

    calls[0].resolve();
    await first;
    await flush();
    expect(calls.map((c) => c.args.content)).toEqual(["old", "new"]);
    calls[1].resolve();
    await second;
  });

  it("does not hold back a write to another path", async () => {
    // 긍정 짝 — 기다리는 것은 같은 경로뿐이다.
    void writeFile("/v/a.md", "a");
    void writeFile("/v/b.md", "b");
    await flush();
    expect(calls.map((c) => c.args.path)).toEqual(["/v/a.md", "/v/b.md"]);
  });

  // 이것을 실패시키는 것: `settled` 를 만들 때 실패를 삼키지 않으면(`write.then(() => undefined)`)
  // 앞 쓰기의 실패가 뒤 쓰기까지 실패시킨다.
  it("lets the next write through after a failed one", async () => {
    const first = writeFile("/v/a.md", "old");
    const second = writeFile("/v/a.md", "new");
    await flush();
    calls[0].reject("disk full");
    await expect(first).rejects.toBe("disk full");
    await flush();
    expect(calls).toHaveLength(2);
    calls[1].resolve();
    await expect(second).resolves.toBeUndefined();
  });

  // 이것을 실패시키는 것: 지우기 전의 `pendingWrites.get(path) === settled` 확인을 빼면 앞 쓰기의 tail 이
  // 뒤 쓰기의 항목을 지워, 셋째 쓰기가 둘째를 기다리지 않는다.
  it("keeps waiting on the newest write when an older one settles", async () => {
    const first = writeFile("/v/a.md", "1");
    const second = writeFile("/v/a.md", "2");
    await flush();
    calls[0].resolve();
    await first;
    await flush();
    const third = writeFile("/v/a.md", "3");
    await flush();
    expect(calls.map((c) => c.args.content)).toEqual(["1", "2"]);

    calls[1].resolve();
    await second;
    await flush();
    calls[2].resolve();
    await third;
  });

  // 이것을 실패시키는 것: tail 이 끝난 뒤 map 에서 지우는 줄을 빼면 경로마다 항목이 남는다.
  it("forgets a path once its writes have settled", async () => {
    const w = writeFile("/v/a.md", "x");
    await flush();
    expect(pendingWritePaths()).toBe(1);
    calls[0].resolve();
    await w;
    await flush();
    expect(pendingWritePaths()).toBe(0);
  });

  // 이것을 실패시키는 것: readFile 의 `await pendingWrites.get(path)` 를 지우면 읽기가 쓰기보다 먼저
  // Rust 로 가서, 다시 연 탭이 쓰기 전의 내용을 받는다.
  it("reads a path only after the write already under way has landed", async () => {
    const w = writeFile("/v/a.md", "x");
    const r = readFile("/v/a.md");
    await flush();
    expect(calls.map((c) => c.cmd)).toEqual(["write_file"]);
    calls[0].resolve();
    await w;
    await flush();
    expect(calls.map((c) => c.cmd)).toEqual(["write_file", "read_file"]);
    calls[1].resolve("x");
    await expect(r).resolves.toBe("x");
  });
});
