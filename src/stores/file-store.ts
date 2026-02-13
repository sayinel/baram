// §3.5 파일 시스템 스토어
import { create } from "zustand";

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileEntry[];
}

interface FileState {
  rootPath: string | null;
  fileTree: FileEntry[];
  openFiles: Map<string, string>; // path → content

  setRootPath: (path: string) => void;
  setFileTree: (tree: FileEntry[]) => void;
  setFileContent: (path: string, content: string) => void;
  removeFileContent: (path: string) => void;
}

export const useFileStore = create<FileState>((set) => ({
  rootPath: null,
  fileTree: [],
  openFiles: new Map(),

  setRootPath: (path) => set({ rootPath: path }),

  setFileTree: (tree) => set({ fileTree: tree }),

  setFileContent: (path, content) =>
    set((state) => {
      const openFiles = new Map(state.openFiles);
      openFiles.set(path, content);
      return { openFiles };
    }),

  removeFileContent: (path) =>
    set((state) => {
      const openFiles = new Map(state.openFiles);
      openFiles.delete(path);
      return { openFiles };
    }),
}));
