// §102 Zettel favorites store — permanent-note ids pinned per zettel vault
import { create } from "zustand";

import { getVaultConfigByPath, setVaultConfigByPath } from "../../ipc/context";

interface ZettelFavoritesState {
  favoriteIds: string[];
  setFavorites: (ids: string[]) => void;
}

export const useZettelFavoritesStore = create<ZettelFavoritesState>((set) => ({
  favoriteIds: [],
  setFavorites: (ids) => set({ favoriteIds: ids }),
}));

/** True if `id` is currently a favorite (reads the store snapshot). */
export function isFavorite(id: string): boolean {
  return useZettelFavoritesStore.getState().favoriteIds.includes(id);
}

/** Load favorites from the zettel vault's .baram/config.json into the store. */
export async function loadFavorites(zettelDir: string): Promise<void> {
  try {
    const cfg = await getVaultConfigByPath(zettelDir);
    useZettelFavoritesStore
      .getState()
      .setFavorites(cfg.zettelkasten?.favorites ?? []);
  } catch {
    useZettelFavoritesStore.getState().setFavorites([]);
  }
}

/**
 * Toggle `id` in the favorites list; persists to vault config (preserving
 * other config fields) and updates the store. Returns the new favorites array.
 */
export async function toggleFavorite(
  zettelDir: string,
  id: string,
): Promise<string[]> {
  const cfg = await getVaultConfigByPath(zettelDir);
  const current = cfg.zettelkasten?.favorites ?? [];
  const next = current.includes(id)
    ? current.filter((x) => x !== id)
    : [...current, id];
  await setVaultConfigByPath(zettelDir, {
    ...cfg,
    zettelkasten: { ...cfg.zettelkasten, favorites: next },
  });
  useZettelFavoritesStore.getState().setFavorites(next);
  return next;
}
