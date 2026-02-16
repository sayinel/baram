// §3.5 파일 시스템 스토어
import { create } from "zustand";
import { listDir } from "../ipc/invoke";
import type { FileEntry as IpcFileEntry } from "../ipc/types";

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

/**
 * Convert flat IPC FileEntry[] into nested tree structure.
 * Groups entries by parent directory, then recursively attaches children.
 * Directories sorted first, then alphabetical.
 */
export function buildFileTree(
  flatEntries: IpcFileEntry[],
  rootPath: string,
): FileEntry[] {
  // Group by parent path
  const childrenMap = new Map<string, IpcFileEntry[]>();
  for (const entry of flatEntries) {
    const parentPath = entry.path.substring(
      0,
      entry.path.length - entry.name.length - 1,
    );
    const list = childrenMap.get(parentPath) || [];
    list.push(entry);
    childrenMap.set(parentPath, list);
  }

  function buildChildren(parentPath: string): FileEntry[] {
    const entries = childrenMap.get(parentPath) || [];
    // dirs first, then alphabetical
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return entries.map((e) => {
      const node: FileEntry = {
        name: e.name,
        path: e.path,
        isDir: e.isDir,
      };
      if (e.isDir) {
        node.children = buildChildren(e.path);
      }
      return node;
    });
  }

  return buildChildren(rootPath);
}

/**
 * Open a folder: list its contents recursively, build tree, update store.
 */
export async function openFolder(path: string): Promise<void> {
  const entries = await listDir(path, true);
  const tree = buildFileTree(entries, path);
  useFileStore.getState().setRootPath(path);
  useFileStore.getState().setFileTree(tree);
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
