import type { TileSetTiles, TileSize } from "../image-tiles";

import { beforeEach, expect, test, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: (m: unknown) => void = () => {};
  },
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: invokeMock,
}));

import { imageTiles, tileUrl } from "../image-tiles";

const SET: TileSetTiles = {
  bytes: 0,
  dir: "/c/k",
  ext: "jpg",
  height: 3060,
  kind: "tiles",
  levels: [{ h: 3060, w: 4080 }],
  tile: 512,
  width: 4080,
};

beforeEach(() => {
  invokeMock.mockReset();
});

test("tileUrl composes the cache path of one tile", () => {
  expect(tileUrl(SET, 2, 3, 1)).toBe("asset://localhost//c/k/2/3_1.jpg");
});

test("imageTiles forwards channel messages to onSize and resolves the answer", async () => {
  const sizes: TileSize[] = [];
  invokeMock.mockImplementation(
    async (
      _cmd: string,
      args: { onSize: { onmessage: (m: TileSize) => void } },
    ) => {
      args.onSize.onmessage({ height: 5, width: 7 });
      return SET;
    },
  );
  const out = await imageTiles("/p.jpg", (s) => sizes.push(s));
  expect(out).toBe(SET);
  expect(sizes).toEqual([{ height: 5, width: 7 }]);
  expect(invokeMock).toHaveBeenCalledWith(
    "image_tiles",
    expect.objectContaining({ path: "/p.jpg" }),
  );
});
