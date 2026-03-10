// §30 Graph View — settings store for graph visualization
import { create } from "zustand";

export interface GraphSettingsState {
  // Forces
  centerForce: number;
  colorByNamespace: boolean;
  existingFilesOnly: boolean;
  linkDistance: number;
  linkForce: number;
  linkThickness: number;

  namespaceFilter: string;
  // Display
  nodeSize: number;
  repelForce: number;
  // Filters
  searchQuery: string;

  setCenterForce: (v: number) => void;
  setColorByNamespace: (v: boolean) => void;
  setExistingFilesOnly: (v: boolean) => void;
  setLinkDistance: (v: number) => void;

  setLinkForce: (v: number) => void;
  setLinkThickness: (v: number) => void;
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

export const useGraphSettingsStore = create<GraphSettingsState>((set) => ({
  // Filters
  searchQuery: "",
  showOrphans: true,
  existingFilesOnly: false,
  showTags: true,
  colorByNamespace: true,
  namespaceFilter: "",

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
  setCenterForce: (v) => set({ centerForce: v }),
  setRepelForce: (v) => set({ repelForce: v }),
  setLinkForce: (v) => set({ linkForce: v }),
  setLinkDistance: (v) => set({ linkDistance: v }),
}));
