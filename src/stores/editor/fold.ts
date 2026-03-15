// Fold state persistence — content-based anchors per file
// Pattern: settings-store.ts (Zustand + persist middleware)

import type { FoldAnchor } from "../../extensions/plugins/fold";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { tauriStorage } from "../system/tauri-storage";

interface FoldStoreState {
  clearAll: () => void;

  clearFolds: (filePath: string) => void;
  /** filePath → array of fold anchors */
  foldAnchors: Record<string, FoldAnchor[]>;
  getFolds: (filePath: string) => FoldAnchor[];
  saveFolds: (filePath: string, anchors: FoldAnchor[]) => void;
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
