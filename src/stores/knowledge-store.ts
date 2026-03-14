// §11.4 Knowledge Q&A — vault indexing and search state
import { create } from "zustand";

export type IndexingStatus = "error" | "idle" | "indexing" | "ready";

interface KnowledgeState {
  /** Last error message */
  error: null | string;
  /** Number of files indexed so far */
  indexedFiles: number;
  /** Current indexing status */
  indexingStatus: IndexingStatus;
  /** Reset all state to initial values */
  reset: () => void;
  /** Set error status with message */
  setError: (error: string) => void;
  /** Update indexing progress — sets status to 'indexing', or 'ready' when indexed === total */
  setIndexingProgress: (indexed: number, total: number) => void;
  /** Set total chunks count */
  setTotalChunks: (chunks: number) => void;
  /** Total number of chunks in the index */
  totalChunks: number;
  /** Total number of files to index */
  totalFiles: number;
}

export const useKnowledgeStore = create<KnowledgeState>()((set) => ({
  indexingStatus: "idle",
  indexedFiles: 0,
  totalFiles: 0,
  totalChunks: 0,
  error: null,

  setIndexingProgress: (indexed: number, total: number) =>
    set({
      indexedFiles: indexed,
      totalFiles: total,
      indexingStatus: indexed === total ? "ready" : "indexing",
      error: null,
    }),

  setTotalChunks: (chunks: number) => set({ totalChunks: chunks }),

  setError: (error: string) => set({ indexingStatus: "error", error }),

  reset: () =>
    set({
      indexingStatus: "idle",
      indexedFiles: 0,
      totalFiles: 0,
      totalChunks: 0,
      error: null,
    }),
}));
