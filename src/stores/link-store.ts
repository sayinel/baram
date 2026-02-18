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
  /** Monotonic counter — incremented when the Rust index changes, triggers refetch */
  indexVersion: number;

  /** Set backlinks data (called after IPC response) */
  setBacklinks: (path: string, entries: BacklinkEntry[]) => void;
  /** Set loading state */
  setLoading: (loading: boolean) => void;
  /** Set error state */
  setError: (error: string | null) => void;
  /** Clear all cached data */
  clear: () => void;
  /** Signal that the Rust index was updated — triggers Backlinks refetch */
  invalidate: () => void;
  /** Wikilink target to scroll to after backlink navigation (filename stem) */
  pendingScrollTarget: string | null;
  /** Set pending scroll target (consumed by App.tsx after tab switch) */
  setPendingScrollTarget: (target: string | null) => void;
}

export const useLinkStore = create<LinkState>((set, get) => ({
  backlinks: [],
  loading: false,
  error: null,
  cachedPath: null,
  indexVersion: 0,

  setBacklinks: (path, entries) =>
    set({ backlinks: entries, cachedPath: path, loading: false, error: null }),

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error, loading: false }),

  clear: () =>
    set({ backlinks: [], loading: false, error: null, cachedPath: null }),

  invalidate: () => set({ indexVersion: get().indexVersion + 1 }),

  pendingScrollTarget: null,
  setPendingScrollTarget: (target) => set({ pendingScrollTarget: target }),
}));
