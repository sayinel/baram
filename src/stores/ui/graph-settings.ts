// §30 Graph View — settings store for graph visualization
// Persisted via tauriStorage (§30.4); pattern: stores/editor/fold.ts
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { tauriStorage } from "../system/tauri-storage";

/** §30.3 Graph scope — current vault / all vaults (§87) / active-file local */
export type GraphScope = "all" | "current" | "local";

export interface GraphSettingsState {
  // Forces
  centerForce: number;
  clearExcluded: () => void;
  colorByNamespace: boolean;
  /** §30.4a Node ids excluded via the context menu (persisted) */
  excludedPaths: string[];
  excludeNode: (path: string) => void;
  existingFilesOnly: boolean;
  // §30.3 Scope
  graphScope: GraphScope;
  linkDistance: number;
  linkForce: number;
  linkThickness: number;
  /** §30.3 Local scope BFS depth (1..3) */
  localDepth: number;
  /** §30.3d Local scope: follow backlinks (links pointing to the file) */
  localIncoming: boolean;
  /** §30.3e Local scope: show links between same-depth neighbors */
  localNeighborLinks: boolean;
  /** §30.3d Local scope: follow forward links (links from the file) */
  localOutgoing: boolean;

  namespaceFilter: string;
  // Display
  nodeSize: number;
  repelForce: number;
  // Filters
  searchQuery: string;

  setCenterForce: (v: number) => void;
  setColorByNamespace: (v: boolean) => void;
  setExistingFilesOnly: (v: boolean) => void;
  setGraphScope: (v: GraphScope) => void;
  setLinkDistance: (v: number) => void;

  setLinkForce: (v: number) => void;
  setLinkThickness: (v: number) => void;
  setLocalDepth: (v: number) => void;
  setLocalIncoming: (v: boolean) => void;
  setLocalNeighborLinks: (v: boolean) => void;
  setLocalOutgoing: (v: boolean) => void;
  setNamespaceFilter: (v: string) => void;
  setNodeSize: (v: number) => void;
  setRepelForce: (v: number) => void;
  // Actions
  setSearchQuery: (v: string) => void;
  setShowArrows: (v: boolean) => void;
  setShowOrphans: (v: boolean) => void;
  setShowTags: (v: boolean) => void;
  setTextFadeThreshold: (v: number) => void;
  showArrows: boolean;
  showOrphans: boolean;
  showTags: boolean;
  textFadeThreshold: number;
}

/** §30.4 Session-only text filters — excluded from persistence */
const TRANSIENT_KEYS = new Set(["namespaceFilter", "searchQuery"]);

export const useGraphSettingsStore = create<GraphSettingsState>()(
  persist(
    (set) => ({
      // Filters
      searchQuery: "",
      showOrphans: true,
      existingFilesOnly: false,
      showTags: true,
      colorByNamespace: true,
      namespaceFilter: "",

      // §30.3 Scope
      graphScope: "current",
      localDepth: 1,
      localIncoming: true,
      localOutgoing: true,
      localNeighborLinks: true,

      // §30.4a Exclusions
      excludedPaths: [],

      // Display
      nodeSize: 20,
      linkThickness: 1,
      textFadeThreshold: 0.5,
      showArrows: true,

      // Forces
      centerForce: 0.25,
      repelForce: 8,
      linkForce: 0.45,
      linkDistance: 80,

      // Actions
      setSearchQuery: (v) => set({ searchQuery: v }),
      setShowOrphans: (v) => set({ showOrphans: v }),
      setExistingFilesOnly: (v) => set({ existingFilesOnly: v }),
      setShowTags: (v) => set({ showTags: v }),
      setColorByNamespace: (v) => set({ colorByNamespace: v }),
      setNamespaceFilter: (v) => set({ namespaceFilter: v }),
      setNodeSize: (v) => set({ nodeSize: v }),
      setLinkThickness: (v) => set({ linkThickness: v }),
      setTextFadeThreshold: (v) => set({ textFadeThreshold: v }),
      setShowArrows: (v) => set({ showArrows: v }),
      setGraphScope: (v) => set({ graphScope: v }),
      setLocalDepth: (v) => set({ localDepth: v }),
      setLocalIncoming: (v) => set({ localIncoming: v }),
      setLocalOutgoing: (v) => set({ localOutgoing: v }),
      setLocalNeighborLinks: (v) => set({ localNeighborLinks: v }),
      excludeNode: (path) =>
        set((state) =>
          state.excludedPaths.includes(path)
            ? state
            : { excludedPaths: [...state.excludedPaths, path] },
        ),
      clearExcluded: () => set({ excludedPaths: [] }),
      setCenterForce: (v) => set({ centerForce: v }),
      setRepelForce: (v) => set({ repelForce: v }),
      setLinkForce: (v) => set({ linkForce: v }),
      setLinkDistance: (v) => set({ linkDistance: v }),
    }),
    {
      name: "baram-graph-settings",
      version: 1,
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) =>
        Object.fromEntries(
          Object.entries(state).filter(
            ([key, value]) =>
              typeof value !== "function" && !TRANSIENT_KEYS.has(key),
          ),
        ) as Partial<GraphSettingsState>,
    },
  ),
);
