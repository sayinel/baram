// §397 원본 보기 — `image_tiles` 의 답을 뷰어의 상태로. Rust 를 부르는 `imageTiles` 를 목으로 바꾸고
// 결과를 시험이 손으로 푼다(deferred) — 크기 채널 · 답 · 늦게 온 답의 순서를 시험이 정한다.
import type { TileSet, TileSetTiles, TileSize } from "../../ipc/image-tiles";

import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

vi.mock("../../ipc/image-tiles", () => ({
  imageTiles: vi.fn(),
  tileUrl: vi.fn(),
}));

const { imageTiles } = await import("../../ipc/image-tiles");
const { useImageTiles } = await import("../use-image-tiles");

interface Call {
  onSize: (size: TileSize) => void;
  path: string;
  reject: (reason: unknown) => void;
  resolve: (set: TileSet) => void;
}

const SET: TileSetTiles = {
  bytes: 34_000_000,
  dir: "/cache/v2/tiles/t1/abc",
  ext: "jpg",
  height: 12240,
  kind: "tiles",
  levels: [
    { h: 12240, w: 16320 },
    { h: 6120, w: 8160 },
  ],
  tile: 512,
  width: 16320,
};

let calls: Call[] = [];

beforeEach(() => {
  calls = [];
  vi.mocked(imageTiles).mockReset();
  vi.mocked(imageTiles).mockImplementation(
    (path, onSize) =>
      new Promise<TileSet>((resolve, reject) => {
        calls.push({ onSize, path, reject, resolve });
      }),
  );
});

test("a null path is original from the first render and never asks Rust", () => {
  const { result } = renderHook(() => useImageTiles(null));
  expect(result.current).toEqual({ set: null, size: null, status: "original" });
  expect(imageTiles).not.toHaveBeenCalled();
});

test("reports the size before the tiles, then the tiles", async () => {
  const { result } = renderHook(() => useImageTiles("/vault/big.jpg"));
  expect(result.current).toEqual({ set: null, size: null, status: "pending" });
  expect(calls.map((c) => c.path)).toEqual(["/vault/big.jpg"]);

  act(() => calls[0].onSize({ height: 12240, width: 16320 }));
  expect(result.current).toEqual({
    set: null,
    size: { height: 12240, width: 16320 },
    status: "pending",
  });

  await act(async () => calls[0].resolve(SET));
  expect(result.current).toEqual({
    set: SET,
    size: { height: 12240, width: 16320 },
    status: "tiles",
  });
});

test("a cache hit goes straight to tiles, its size taken from the set", async () => {
  const { result } = renderHook(() => useImageTiles("/vault/big.jpg"));
  await act(async () => calls[0].resolve(SET));
  expect(result.current).toEqual({
    set: SET,
    size: { height: 12240, width: 16320 },
    status: "tiles",
  });
});

test("a size that arrives after the answer does not undo the tiles", async () => {
  const { result } = renderHook(() => useImageTiles("/vault/big.jpg"));
  await act(async () => calls[0].resolve(SET));
  act(() => calls[0].onSize({ height: 1, width: 1 }));
  expect(result.current).toEqual({
    set: SET,
    size: { height: 12240, width: 16320 },
    status: "tiles",
  });
});

test("a rejection or an original answer falls back to original", async () => {
  const rejected = renderHook(() => useImageTiles("/vault/broken.jpg"));
  await act(async () => calls[0].reject("decode failed"));
  expect(rejected.result.current).toEqual({
    set: null,
    size: null,
    status: "original",
  });

  const original = renderHook(() => useImageTiles("/vault/small.jpg"));
  act(() => calls[1].onSize({ height: 12240, width: 16320 }));
  await act(async () => calls[1].resolve({ kind: "original" }));
  expect(original.result.current).toEqual({
    set: null,
    size: null,
    status: "original",
  });
});

test("a result that arrives after unmount or a path change is dropped", async () => {
  // 경로 변경: A 를 기다리는 중에 B 로 — A 의 크기 · 답은 B 의 상태를 바꾸지 않는다
  const { rerender, result, unmount } = renderHook(
    ({ path }: { path: string }) => useImageTiles(path),
    { initialProps: { path: "/vault/a.jpg" } },
  );
  rerender({ path: "/vault/b.jpg" });
  expect(calls.map((c) => c.path)).toEqual(["/vault/a.jpg", "/vault/b.jpg"]);
  expect(result.current).toEqual({ set: null, size: null, status: "pending" });

  act(() => calls[0].onSize({ height: 1, width: 1 }));
  await act(async () => calls[0].resolve(SET));
  expect(result.current).toEqual({ set: null, size: null, status: "pending" });

  const setB: TileSetTiles = { ...SET, dir: "/cache/v2/tiles/t1/b" };
  await act(async () => calls[1].resolve(setB));
  expect(result.current).toEqual({
    set: setB,
    size: { height: 12240, width: 16320 },
    status: "tiles",
  });

  // 경로가 B 의 답을 받은 뒤 바뀌어도, 새 경로의 첫 렌더는 이전 경로의 답을 보이지 않는다
  rerender({ path: "/vault/c.jpg" });
  expect(result.current).toEqual({ set: null, size: null, status: "pending" });

  // 언마운트 뒤에 온 크기 · 답 — 상태를 볼 렌더가 없으니 여기서 보이는 것은 "던지지 않는다" 뿐이다.
  // 그 관문(effect 정리가 내리는 `live`)은 다음 시험 — 같은 경로로 돌아온 뒤의 늦은 답 — 이 실패시킨다.
  unmount();
  calls[2].onSize({ height: 1, width: 1 });
  await act(async () => calls[2].resolve(SET));
  expect(result.current).toEqual({ set: null, size: null, status: "pending" });
});

test("an answer asked before leaving a path is dropped even when the path comes back", async () => {
  const { rerender, result } = renderHook(
    ({ path }: { path: string }) => useImageTiles(path),
    { initialProps: { path: "/vault/a.jpg" } },
  );
  rerender({ path: "/vault/b.jpg" });
  rerender({ path: "/vault/a.jpg" });
  expect(calls.map((c) => c.path)).toEqual([
    "/vault/a.jpg",
    "/vault/b.jpg",
    "/vault/a.jpg",
  ]);

  // 처음 A 의 답은 B 로 떠난 뒤에 왔다 — 경로가 같아도 지금 A 의 답이 아니다
  const stale: TileSetTiles = { ...SET, dir: "/cache/v2/tiles/t1/stale" };
  await act(async () => calls[0].resolve(stale));
  expect(result.current).toEqual({ set: null, size: null, status: "pending" });

  await act(async () => calls[2].resolve(SET));
  expect(result.current.set).toBe(SET);
});
