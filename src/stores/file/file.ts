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
  /**
   * §56b Enter journal scope: save rootPath, switch to journal directory
   * @deprecated Use contextStore.ensureJournalContext() instead (§85 M2b)
   */
  enterJournalScope: (journalDir: string) => void;

  /**
   * §56b Exit journal scope: restore original rootPath
   * @deprecated Use context switching instead (§85 M2b)
   */
  exitJournalScope: () => void;
  expandDir: (path: string) => void;

  // FileTree expanded directories (persisted across sidebar tab switches)
  expandedDirs: Set<string>;
  fileTree: FileEntry[];
  /**
   * @deprecated Use isActiveContextJournal() instead (§85 M2b)
   */
  isJournalScoped: boolean;
  /** Move a file/folder entry to a new parent directory */
  moveFileEntry: (oldPath: string, newParentPath: string) => void;
  openFiles: Map<string, string>; // path → content
  /**
   * §56b Journal workspace scoping
   * @deprecated Use contextStore.ensureJournalContext() instead (§85 M2b)
   */
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
 * §81 Open an additional folder as a new context without replacing the current one.
 * Used by the "+" button in ContextTabBar.
 */
export async function addFolder(path: string): Promise<void> {
  const contextStore = useContextStore.getState();

  // Check if already open — just switch to it
  const existing = contextStore.contexts.find((c) => c.path === path);
  if (existing) {
    await switchContext(existing.id);
    return;
  }

  // §81 Update Rust VaultRootState
  await setVaultRoot(path);

  // Register in frontend contextStore
  const isVault = await listDir(path + "/.baram", false)
    .then(() => true)
    .catch(() => false);
  const folderName =
    path.split("/").pop()?.toLowerCase().replace(/\s+/g, "-") ?? "vault";
  const added = await contextStore.addContext(
    isVault ? "vault" : "folder",
    path,
    { alias: isVault ? folderName : undefined },
  );

  // Explicitly activate the new context (addContext only auto-activates the first)
  contextStore._setActiveContextLocal(added.id);

  // Always use `path` directly — not activeCtx which may be stale
  const entries = await listDir(path, true);
  const tree = buildFileTree(entries, path);
  useFileStore.getState().setRootPath(path);
  useFileStore.getState().setFileTree(tree);

  // Update settings
  useSettingsStore.getState().addRecentFolder(path);

  // Build link index in background
  refreshIndex(path)
    .then(() => useLinkStore.getState().invalidate())
    .catch((err) => logger.warn("§30 addFolder: index build failed", err));
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
 * §81 M2: Does NOT remove existing contexts — supports multi-context.
 */
export async function openFolder(path: string): Promise<void> {
  // §81 Update Rust VaultRootState (always succeeds for valid paths)
  await setVaultRoot(path);

  const contextStore = useContextStore.getState();

  // Check if already open as a context
  const existing = contextStore.contexts.find((c) => c.path === path);
  if (!existing) {
    // New context — register in both Rust + frontend
    const isVault = await listDir(path + "/.baram", false)
      .then(() => true)
      .catch(() => false);
    const folderName =
      path.split("/").pop()?.toLowerCase().replace(/\s+/g, "-") ?? "vault";
    await contextStore
      .addContext(isVault ? "vault" : "folder", path, {
        alias: isVault ? folderName : undefined,
      })
      .catch((err) => {
        logger.warn("§81 openFolder: context registration failed", err);
      });
  } else {
    // Existing context (possibly persisted from previous session)
    // Use local-only activation to avoid IPC failure for stale IDs
    contextStore._setActiveContextLocal(existing.id);
  }

  // Always use `path` directly — not activeCtx?.path which may be stale
  const entries = await listDir(path, true);
  const tree = buildFileTree(entries, path);
  useFileStore.getState().setRootPath(path);
  useFileStore.getState().setFileTree(tree);

  // Update settings
  useSettingsStore.getState().addRecentFolder(path);

  // Build link index in background
  refreshIndex(path)
    .then(() => useLinkStore.getState().invalidate())
    .catch((err) => logger.warn("§30 openFolder: index build failed", err));
}

/**
 * §81 Switch the active context — updates VaultRootState, reloads file tree + index.
 * Called directly from ContextTabBar click handler (not via subscription).
 */
export async function switchContext(contextId: string): Promise<void> {
  const contextStore = useContextStore.getState();
  const ctx = contextStore.contexts.find((c) => c.id === contextId);
  if (!ctx) return;

  // 1. Update frontend active context (no IPC — avoid potential failures)
  contextStore._setActiveContextLocal(contextId);

  // 2. Update Rust VaultRootState
  if (ctx.contextType !== "file") {
    try {
      await setVaultRoot(ctx.path);
    } catch (err) {
      logger.warn("§81 switchContext: setVaultRoot failed", err);
    }

    // 3. Reload file tree
    try {
      const entries = await listDir(ctx.path, true);
      const tree = buildFileTree(entries, ctx.path);
      useFileStore.getState().setRootPath(ctx.path);
      useFileStore.getState().setFileTree(tree);
    } catch (err) {
      logger.warn("§81 switchContext: listDir failed", err);
    }

    // 4. Rebuild link index in background
    refreshIndex(ctx.path)
      .then(() => useLinkStore.getState().invalidate())
      .catch((err) =>
        logger.warn("§81 switchContext: refreshIndex failed", err),
      );
  } else {
    // FileContext: clear file tree
    useFileStore.getState().setRootPath(null as unknown as string);
    useFileStore.getState().setFileTree([]);
  }
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

    // §81 Remove all contexts so the context tab bar clears
    const ctxStore = useContextStore.getState();
    for (const ctx of [...ctxStore.contexts]) {
      ctxStore.removeContext(ctx.id).catch(() => {});
    }
  },
}));

/**
 * §85 M2b: Check if the active context is a journal vault.
 * Replaces the old isJournalScoped flag.
 */
export function isActiveContextJournal(): boolean {
  const ctx = useContextStore.getState().activeContext();
  return ctx?.vaultType === "journal";
}

/**
 * §81 Cross-store sync: keep fileStore.rootPath in sync with the active context.
 *
 * File tree reload and index rebuild are handled EXPLICITLY by:
 * - switchContext() — called from ContextTabBar click
 * - openFolder() / addFolder() — called from folder open flows
 *
 * This subscription only syncs rootPath for components that read it.
 * It does NOT call listDir/setFileTree to avoid race conditions and
 * unexpected FileTree refreshes during normal file operations.
 */
useContextStore.subscribe((state, prevState) => {
  if (state.activeContextId === prevState.activeContextId) return;
  if (!state.activeContextId) return;

  const ctx = state.contexts.find((c) => c.id === state.activeContextId);
  if (!ctx) return;

  // Sync rootPath only (no listDir, no refreshIndex)
  if (ctx.contextType !== "file") {
    const fileStore = useFileStore.getState();
    if (fileStore.rootPath !== ctx.path) {
      fileStore.setRootPath(ctx.path);
    }
  }
});
