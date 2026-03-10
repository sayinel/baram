import type { BacklinkEntry, UnlinkedMention } from "../ipc/types";

// §29 링크 인덱스 스토어 — 백링크, 링크 그래프 프론트엔드 캐시
// §34 언링크드 멘션 상태 추가
import { create } from "zustand";

interface LinkState {
  /** Backlinks for the currently viewed file */
  backlinks: BacklinkEntry[];
  /** Path of the file whose backlinks are cached */
  cachedPath: null | string;
  /** Clear all cached data */
  clear: () => void;
  /** Last error from IPC */
  error: null | string;
  /** Monotonic counter — incremented when the Rust index changes, triggers refetch */
  indexVersion: number;
  /** Signal that the Rust index was updated — triggers Backlinks refetch */
  invalidate: () => void;

  /** Whether backlinks are being loaded */
  loading: boolean;
  /** §30c Block ID to scroll to after block ref navigation */
  pendingScrollBlockId: null | string;
  /** Markdown line number to scroll to after backlink navigation (1-based) */
  pendingScrollLine: null | number;
  /** Set backlinks data (called after IPC response) */
  setBacklinks: (path: string, entries: BacklinkEntry[]) => void;
  /** Set error state */
  setError: (error: null | string) => void;
  /** Set loading state */
  setLoading: (loading: boolean) => void;
  /** Set pending scroll block ID (consumed by App.tsx after tab switch) */
  setPendingScrollBlockId: (id: null | string) => void;
  /** Set pending scroll line (consumed by App.tsx after tab switch) */
  setPendingScrollLine: (line: null | number) => void;
  /** §34 Set unlinked mentions data */
  setUnlinkedMentions: (entries: UnlinkedMention[]) => void;
  /** §34 Unlinked mentions for the currently viewed file */
  unlinkedMentions: UnlinkedMention[];
}

export const useLinkStore = create<LinkState>((set, get) => ({
  backlinks: [],
  unlinkedMentions: [],
  loading: false,
  error: null,
  cachedPath: null,
  indexVersion: 0,

  setBacklinks: (path, entries) =>
    set({ backlinks: entries, cachedPath: path, loading: false, error: null }),

  setUnlinkedMentions: (entries) => set({ unlinkedMentions: entries }),

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error, loading: false }),

  clear: () =>
    set({
      backlinks: [],
      unlinkedMentions: [],
      loading: false,
      error: null,
      cachedPath: null,
    }),

  invalidate: () => set({ indexVersion: get().indexVersion + 1 }),

  pendingScrollLine: null,
  setPendingScrollLine: (line) => set({ pendingScrollLine: line }),
  pendingScrollBlockId: null,
  setPendingScrollBlockId: (id) => set({ pendingScrollBlockId: id }),
}));
