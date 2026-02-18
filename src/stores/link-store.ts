// §29 링크 인덱스 스토어 — 백링크, 링크 그래프 프론트엔드 캐시
import { create } from "zustand";
import type { BacklinkEntry } from "../ipc/types";

interface LinkState {
  /** Backlinks for the currently viewed file */
  backlinks: BacklinkEntry[];
  /** Whether backlinks are being loaded */
  loading: boolean;
  /** Last error from IPC */
  error: string | null;
  /** Path of the file whose backlinks are cached */
  cachedPath: string | null;

  /** Set backlinks data (called after IPC response) */
  setBacklinks: (path: string, entries: BacklinkEntry[]) => void;
  /** Set loading state */
  setLoading: (loading: boolean) => void;
  /** Set error state */
  setError: (error: string | null) => void;
  /** Clear all cached data */
  clear: () => void;
}

export const useLinkStore = create<LinkState>((set) => ({
  backlinks: [],
  loading: false,
  error: null,
  cachedPath: null,

  setBacklinks: (path, entries) =>
    set({ backlinks: entries, cachedPath: path, loading: false, error: null }),

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error, loading: false }),

  clear: () =>
    set({ backlinks: [], loading: false, error: null, cachedPath: null }),
}));
