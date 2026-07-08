import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above top-level consts, so the mocked fns
// must be created via vi.hoisted() to be safely referenced inside them.
const { getVaultConfigByPath, setVaultConfigByPath } = vi.hoisted(() => ({
  getVaultConfigByPath: vi.fn(),
  setVaultConfigByPath: vi.fn(),
}));
vi.mock("../../../ipc/context", () => ({
  getVaultConfigByPath,
  setVaultConfigByPath,
}));

import {
  isFavorite,
  loadFavorites,
  toggleFavorite,
  useZettelFavoritesStore,
} from "../zettel-favorites";

describe("zettel favorites", () => {
  beforeEach(() => {
    useZettelFavoritesStore.getState().setFavorites([]);
    getVaultConfigByPath.mockReset();
    setVaultConfigByPath.mockReset();
  });

  describe("loadFavorites", () => {
    it("reads zettelkasten.favorites into the store", async () => {
      getVaultConfigByPath.mockResolvedValue({
        zettelkasten: { favorites: ["a", "b"] },
      });
      await loadFavorites("/z");
      expect(useZettelFavoritesStore.getState().favoriteIds).toEqual([
        "a",
        "b",
      ]);
    });

    it("defaults to [] when zettelkasten.favorites is missing", async () => {
      getVaultConfigByPath.mockResolvedValue({});
      await loadFavorites("/z");
      expect(useZettelFavoritesStore.getState().favoriteIds).toEqual([]);
    });

    it("defaults to [] when getVaultConfigByPath throws", async () => {
      getVaultConfigByPath.mockRejectedValue(new Error("no config"));
      await loadFavorites("/z");
      expect(useZettelFavoritesStore.getState().favoriteIds).toEqual([]);
    });
  });

  describe("toggleFavorite", () => {
    it("adds an id when absent", async () => {
      getVaultConfigByPath.mockResolvedValue({
        vault: { alias: "z", type: "zettelkasten" },
        zettelkasten: { favorites: ["a"] },
      });
      const result = await toggleFavorite("/z", "b");
      expect(result).toEqual(["a", "b"]);
      expect(useZettelFavoritesStore.getState().favoriteIds).toEqual([
        "a",
        "b",
      ]);
    });

    it("removes an id when present", async () => {
      getVaultConfigByPath.mockResolvedValue({
        vault: { alias: "z", type: "zettelkasten" },
        zettelkasten: { favorites: ["a", "b"] },
      });
      const result = await toggleFavorite("/z", "a");
      expect(result).toEqual(["b"]);
      expect(useZettelFavoritesStore.getState().favoriteIds).toEqual(["b"]);
    });

    it("preserves other config fields when persisting", async () => {
      getVaultConfigByPath.mockResolvedValue({
        vault: { alias: "z", type: "zettelkasten" },
        zettelkasten: { favorites: ["a"] },
      });
      await toggleFavorite("/z", "b");
      expect(setVaultConfigByPath).toHaveBeenCalledWith(
        "/z",
        expect.objectContaining({
          vault: { alias: "z", type: "zettelkasten" },
          zettelkasten: { favorites: ["a", "b"] },
        }),
      );
    });
  });

  describe("isFavorite", () => {
    it("reflects the store snapshot", () => {
      useZettelFavoritesStore.getState().setFavorites(["x", "y"]);
      expect(isFavorite("x")).toBe(true);
      expect(isFavorite("z")).toBe(false);
    });
  });
});
