// §30 Graph View — settings store for graph visualization
import { create } from "zustand";

export interface GraphSettingsState {
  // Filters
  searchQuery: string;
  showOrphans: boolean;
  existingFilesOnly: boolean;
  showTags: boolean;
  colorByNamespace: boolean;
  namespaceFilter: string;

  // Display
  nodeSize: number;
  linkThickness: number;
  textFadeThreshold: number;
  showArrows: boolean;

  // Forces
  centerForce: number;
  repelForce: number;
  linkForce: number;
  linkDistance: number;

  // Actions
  setSearchQuery: (v: string) => void;
  setShowOrphans: (v: boolean) => void;
  setExistingFilesOnly: (v: boolean) => void;
  setShowTags: (v: boolean) => void;
  setColorByNamespace: (v: boolean) => void;
  setNamespaceFilter: (v: string) => void;
  setNodeSize: (v: number) => void;
  setLinkThickness: (v: number) => void;
  setTextFadeThreshold: (v: number) => void;
  setShowArrows: (v: boolean) => void;
  setCenterForce: (v: number) => void;
  setRepelForce: (v: number) => void;
  setLinkForce: (v: number) => void;
  setLinkDistance: (v: number) => void;
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
