// Fold state persistence — content-based anchors per file
// Pattern: settings-store.ts (Zustand + persist middleware)

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { tauriStorage } from "./tauri-storage";
import type { FoldAnchor } from "../extensions/plugins/fold";

interface FoldStoreState {
  /** filePath → array of fold anchors */
  foldAnchors: Record<string, FoldAnchor[]>;

  saveFolds: (filePath: string, anchors: FoldAnchor[]) => void;
  getFolds: (filePath: string) => FoldAnchor[];
  clearFolds: (filePath: string) => void;
  clearAll: () => void;
}

export const useFoldStore = create<FoldStoreState>()(
  persist(
    (set, get) => ({
      foldAnchors: {},

      saveFolds: (filePath, anchors) => {
        set((state) => {
          const next = { ...state.foldAnchors };
          if (anchors.length === 0) {
            delete next[filePath];
          } else {
            next[filePath] = anchors;
          }
          return { foldAnchors: next };
        });
      },

      getFolds: (filePath) => {
        return get().foldAnchors[filePath] ?? [];
      },

      clearFolds: (filePath) => {
        set((state) => {
          const next = { ...state.foldAnchors };
          delete next[filePath];
          return { foldAnchors: next };
        });
      },

      clearAll: () => {
        set({ foldAnchors: {} });
      },
    }),
    {
      name: "baram-fold-state",
      version: 1,
      storage: createJSONStorage(() => tauriStorage),
    },
  ),
);
