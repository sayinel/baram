// §4.3 File tree — Context Provider for shared read-only state
// Eliminates props drilling of 6 frequently-read states through FileTreeNode
import { createContext, useContext } from "react";

import type { CreatingEntryState } from "./file-tree-types";

export interface FileTreeContextValue {
  creatingEntry: CreatingEntryState | null;
  dragOverPath: null | string;
  dragSourcePaths: string[];
  expandedDirs: Set<string>;
  renamingPath: null | string;
  selectedPaths: Set<string>;
}

const FileTreeCtx = createContext<FileTreeContextValue | null>(null);

export const FileTreeProvider = FileTreeCtx.Provider;

export function useFileTreeContext(): FileTreeContextValue {
  const ctx = useContext(FileTreeCtx);
  if (!ctx) {
    throw new Error("useFileTreeContext must be used within FileTreeProvider");
  }
  return ctx;
}
