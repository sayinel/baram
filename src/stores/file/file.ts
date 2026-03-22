import type { FileEntry as IpcFileEntry } from "../../ipc/types";

// §3.5 파일 시스템 스토어
import { create } from "zustand";

import { listDir, refreshIndex, setVaultRoot } from "../../ipc/invoke";
import { logger } from "../../utils/logger";
import { useContextStore } from "../context/context";
import { useEditorStore } from "../editor/editor";
import { useLinkStore } from "../editor/link";
import { useSettingsStore } from "../settings/store";

export interface FileEntry {
  children?: FileEntry[];
  isDir: boolean;
  name: string;
  path: string;
}

interface FileState {
  /** Add a file/folder entry under parentPath (sorted: dirs first, then name) */
  addFileEntry: (parentPath: string, entry: FileEntry) => void;
  /** Close the current folder and return to home screen */
  closeFolder: () => void;
  /** §56b Enter journal scope: save rootPath, switch to journal directory */
  enterJournalScope: (journalDir: string) => void;

  /** §56b Exit journal scope: restore original rootPath */
  exitJournalScope: () => void;
  expandDir: (path: string) => void;

  // FileTree expanded directories (persisted across sidebar tab switches)
  expandedDirs: Set<string>;
  fileTree: FileEntry[];
  isJournalScoped: boolean;
  /** Move a file/folder entry to a new parent directory */
  moveFileEntry: (oldPath: string, newParentPath: string) => void;
  openFiles: Map<string, string>; // path → content
  // §56b Journal workspace scoping
  originalRootPath: null | string; // rootPath backup before journal scope
  removeFileContent: (path: string) => void;
  /** Remove a file/folder entry by path */
  removeFileEntry: (path: string) => void;
  /** §33 Rename a file entry in the tree and update openFiles cache key */
  renameFileEntry: (oldPath: string, newPath: string, newName: string) => void;
  rootPath: null | string;

  setFileContent: (path: string, content: string) => void;
  setFileTree: (tree: FileEntry[]) => void;

  setRootPath: (path: string) => void;
  setTagFilter: (tag: null | string) => void;
  // Tag filter for FileTree
  tagFilter: null | string;
  toggleExpandedDir: (path: string) => void;
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
  await setVaultRoot(path);

  // §81 Register in frontend contextStore (M1: single context only)
  const contextStore = useContextStore.getState();
  // Remove any existing contexts (M1: only one at a time)
  for (const ctx of [...contextStore.contexts]) {
    await contextStore.removeContext(ctx.id).catch(() => {});
  }
  // Detect vault vs folder
  const isVault = await listDir(path + "/.baram", false)
    .then(() => true)
    .catch(() => false);
  await contextStore
    .addContext(isVault ? "vault" : "folder", path)
    .catch((err) => {
      // Non-fatal: context registration is supplementary in M1
      logger.warn("§81 openFolder: context registration failed", err);
    });

  const entries = await listDir(path, true);
  const tree = buildFileTree(entries, path);
  useFileStore.getState().setRootPath(path);
  useFileStore.getState().setFileTree(tree);

  // Build link index in background so Graph View / Backlinks have data immediately
  refreshIndex(path)
    .then(() => useLinkStore.getState().invalidate())
    .catch((err) => logger.warn("§30 openFolder: index build failed", err));
}

export const useFileStore = create<FileState>((set, get) => ({
  rootPath: null,
  fileTree: [],
  openFiles: new Map(),

  // §56b Journal scoping
  originalRootPath: null,
  isJournalScoped: false,

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

  renameFileEntry: (oldPath, newPath, newName) =>
    set((state) => {
      // Update openFiles cache: move content from old key to new key
      const openFiles = new Map(state.openFiles);
      // For directories, update all keys with the old prefix
      for (const [key, value] of openFiles) {
        if (key === oldPath || key.startsWith(oldPath + "/")) {
          openFiles.delete(key);
          const newKey = newPath + key.slice(oldPath.length);
          openFiles.set(newKey, value);
        }
      }

      // Update file tree: recursively find and rename the entry + children
      function updateTree(entries: FileEntry[]): FileEntry[] {
        return entries.map((e) => {
          if (e.path === oldPath) {
            // Rename this entry and recursively update children paths
            function updateChildren(children: FileEntry[]): FileEntry[] {
              return children.map((c) => {
                const childNewPath = newPath + c.path.slice(oldPath.length);
                const updated = { ...c, path: childNewPath };
                if (c.isDir && c.children) {
                  updated.children = updateChildren(c.children);
                }
                return updated;
              });
            }
            const result: FileEntry = { ...e, name: newName, path: newPath };
            if (e.isDir && e.children) {
              result.children = updateChildren(e.children);
            }
            return result;
          }
          if (e.isDir && e.children) {
            return { ...e, children: updateTree(e.children) };
          }
          return e;
        });
      }

      return { openFiles, fileTree: updateTree(state.fileTree) };
    }),

  addFileEntry: (parentPath, entry) =>
    set((state) => {
      function insertSorted(
        entries: FileEntry[],
        newEntry: FileEntry,
      ): FileEntry[] {
        // Skip if already exists (idempotent)
        if (entries.some((e) => e.path === newEntry.path)) return entries;
        const result = [...entries, newEntry];
        result.sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        return result;
      }

      // If parentPath is rootPath, insert at top level
      if (parentPath === state.rootPath) {
        return { fileTree: insertSorted(state.fileTree, entry) };
      }

      // Otherwise, find parent dir and insert there
      function addToTree(entries: FileEntry[]): FileEntry[] {
        return entries.map((e) => {
          if (e.path === parentPath && e.isDir) {
            return { ...e, children: insertSorted(e.children || [], entry) };
          }
          if (e.isDir && e.children) {
            return { ...e, children: addToTree(e.children) };
          }
          return e;
        });
      }

      return { fileTree: addToTree(state.fileTree) };
    }),

  removeFileEntry: (path) =>
    set((state) => {
      // Remove from openFiles (for files) and any children (for dirs)
      const openFiles = new Map(state.openFiles);
      for (const key of openFiles.keys()) {
        if (key === path || key.startsWith(path + "/")) {
          openFiles.delete(key);
        }
      }

      function removeFromTree(entries: FileEntry[]): FileEntry[] {
        return entries
          .filter((e) => e.path !== path)
          .map((e) => {
            if (e.isDir && e.children) {
              return { ...e, children: removeFromTree(e.children) };
            }
            return e;
          });
      }

      return { openFiles, fileTree: removeFromTree(state.fileTree) };
    }),

  moveFileEntry: (oldPath, newParentPath) =>
    set((state) => {
      // Find the entry to move
      function findEntry(entries: FileEntry[]): FileEntry | null {
        for (const e of entries) {
          if (e.path === oldPath) return e;
          if (e.isDir && e.children) {
            const found = findEntry(e.children);
            if (found) return found;
          }
        }
        return null;
      }

      const entry = findEntry(state.fileTree);
      if (!entry) return state;

      const newPath = newParentPath + "/" + entry.name;
      const movedEntry: FileEntry = { ...entry, path: newPath };

      // Update openFiles key
      const openFiles = new Map(state.openFiles);
      const content = openFiles.get(oldPath);
      if (content !== undefined) {
        openFiles.delete(oldPath);
        openFiles.set(newPath, content);
      }

      // Remove from old location
      function removeFromTree(entries: FileEntry[]): FileEntry[] {
        return entries
          .filter((e) => e.path !== oldPath)
          .map((e) => {
            if (e.isDir && e.children) {
              return { ...e, children: removeFromTree(e.children) };
            }
            return e;
          });
      }

      // Insert into new location (sorted)
      function insertSorted(
        entries: FileEntry[],
        newEntry: FileEntry,
      ): FileEntry[] {
        const result = [...entries, newEntry];
        result.sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        return result;
      }

      let newTree = removeFromTree(state.fileTree);

      if (newParentPath === state.rootPath) {
        newTree = insertSorted(newTree, movedEntry);
      } else {
        function addToTree(entries: FileEntry[]): FileEntry[] {
          return entries.map((e) => {
            if (e.path === newParentPath && e.isDir) {
              return {
                ...e,
                children: insertSorted(e.children || [], movedEntry),
              };
            }
            if (e.isDir && e.children) {
              return { ...e, children: addToTree(e.children) };
            }
            return e;
          });
        }
        newTree = addToTree(newTree);
      }

      return { openFiles, fileTree: newTree };
    }),

  enterJournalScope: (journalDir) => {
    const state = get();
    // Only save original if not already scoped
    const originalRootPath = state.isJournalScoped
      ? state.originalRootPath
      : state.rootPath;
    set({
      originalRootPath,
      rootPath: journalDir,
      isJournalScoped: true,
    });
  },

  exitJournalScope: () => {
    const state = get();
    if (!state.isJournalScoped) return;
    set({
      rootPath: state.originalRootPath,
      originalRootPath: null,
      isJournalScoped: false,
    });
  },

  tagFilter: null,
  setTagFilter: (tagFilter) => set({ tagFilter }),

  expandedDirs: new Set(),
  toggleExpandedDir: (path) =>
    set((state) => {
      const next = new Set(state.expandedDirs);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { expandedDirs: next };
    }),
  expandDir: (path) =>
    set((state) => {
      if (state.expandedDirs.has(path)) return state;
      const next = new Set(state.expandedDirs);
      next.add(path);
      return { expandedDirs: next };
    }),

  closeFolder: () => {
    useEditorStore.getState().closeAllTabs();
    // Clear last-opened so onLaunch won't reopen the closed folder
    useSettingsStore.getState().setLastOpenedFolder(null);
    useSettingsStore.getState().setLastOpenedFile(null);
    set({ rootPath: null, fileTree: [], expandedDirs: new Set() });
  },
}));
