// §3.5 파일 시스템 스토어
import { create } from "zustand";

import { useContextStore } from "../context/context";
import { useEditorStore } from "../editor/editor";
import { useSettingsStore } from "../settings/store";
import {
  addToTree,
  buildFileTree,
  moveInTree,
  rekeyOpenFilesPrefix,
  removeFromTree,
  renameInTree,
} from "./file-tree-ops";
import {
  DEFAULT_SORT_ORDER,
  type SortOrder,
  sortTreeNodes,
} from "./file-tree-sort";

export interface FileEntry {
  children?: FileEntry[];
  isDir: boolean;
  modifiedAt?: number;
  name: string;
  path: string;
}

export interface FileMtimeEntry {
  /** mtime reported by the most recent file:changed event (ms since epoch, 0 = unknown) */
  canReloadMtime: number;
  /** mtime at the time of the last save (ms since epoch, 0 = unknown) */
  lastSaveMtime: number;
}

/** §4.3 Why the file tree failed to load (drives the FolderAccessError panel). */
export type FileTreeLoadError =
  | { kind: "generic"; message: string; path: string }
  | { kind: "permission-denied"; path: string };

interface FileState {
  /** Add a file/folder entry under parentPath (sorted: dirs first, then name) */
  addFileEntry: (parentPath: string, entry: FileEntry) => void;
  /** Close the current folder and return to home screen */
  closeFolder: () => void;
  /** §4.5 Collapse every expanded directory in the file tree */
  collapseAllDirs: () => void;
  expandAllDirs: () => void;
  expandDir: (path: string) => void;

  // FileTree expanded directories (persisted across sidebar tab switches)
  expandedDirs: Set<string>;
  /** path → mtime tracking for external change detection */
  fileMtimes: Map<string, FileMtimeEntry>;
  fileTree: FileEntry[];
  /** §4.5 Active file-tree sort order (persisted per-vault) */
  fileTreeSortOrder: SortOrder;
  /** Return the mtime entry for a path, or undefined if not tracked */
  getFileMtime: (path: string) => FileMtimeEntry | undefined;
  /** Initialize mtime tracking when a file is opened (sets both fields to 0) */
  initFileMtime: (path: string) => void;
  /** §4.3 Non-null when the last file-tree load failed (permission or other) */
  loadError: FileTreeLoadError | null;
  /** Move a file/folder entry to a new parent directory */
  moveFileEntry: (oldPath: string, newParentPath: string) => void;
  openFiles: Map<string, string>; // path → content
  removeFileContent: (path: string) => void;
  /** Remove a file/folder entry by path */
  removeFileEntry: (path: string) => void;
  /** §33 Rename a file entry in the tree and update openFiles cache key */
  renameFileEntry: (oldPath: string, newPath: string, newName: string) => void;
  /** §4.3 Re-run the current folder's file-tree load (used by the retry button) */
  retryLoadFileTree: () => Promise<void>;
  rootPath: null | string;

  setFileContent: (path: string, content: string) => void;
  setFileTree: (tree: FileEntry[]) => void;
  /** §4.5 Set the active sort order, resort the tree, and persist it */
  setFileTreeSortOrder: (order: SortOrder) => void;
  setLoadError: (e: FileTreeLoadError | null) => void;

  setRootPath: (path: string) => void;
  setTagFilter: (tag: null | string) => void;
  // Tag filter for FileTree
  tagFilter: null | string;
  toggleExpandedDir: (path: string) => void;
  /** Record the mtime at the time of a successful save */
  updateCanReloadMtime: (path: string, mtime: number) => void;
  /** Record the mtime reported by the most recent file:changed watcher event */
  updateLastSaveMtime: (path: string, mtime: number) => void;
}

// buildFileTree lives in ./file-tree-ops (pure tree algebra); re-exported
// below for existing callers (work-log.ts, wikilink-suggest.ts, use-navigation.ts).
export { buildFileTree };

// §81/§4.5 addFolder, openFolder, switchContext, _loadContextFileTree, and
// persistSortOrder moved to services/vault-context-loader.ts — they are
// application-level orchestration (i18n, toast, IPC, four other stores), not
// store state. Import them from there. `retryLoadFileTree` and
// `setFileTreeSortOrder` below reach that module through a dynamic `import()`
// deliberately: the service imports `useFileStore` from THIS file, so a
// static import here would recreate a two-file cycle.

export const useFileStore = create<FileState>((set, get) => ({
  rootPath: null,
  fileTree: [],
  openFiles: new Map(),
  fileMtimes: new Map(),
  loadError: null,
  fileTreeSortOrder: DEFAULT_SORT_ORDER,

  setRootPath: (path) => set({ rootPath: path }),

  setFileTree: (tree) => set({ fileTree: tree }),

  setFileTreeSortOrder: (order) => {
    set((state) => ({
      fileTreeSortOrder: order,
      fileTree: sortTreeNodes(state.fileTree, order),
    }));
    const { rootPath } = get();
    if (!rootPath) return;
    // persist to vault config (fire-and-forget; merge with existing config).
    // Dynamic import: see the note above useFileStore for why this can't be static.
    void import("../../services/vault-context-loader").then(
      ({ persistSortOrder }) => persistSortOrder(rootPath, order),
    );
  },

  collapseAllDirs: () => set({ expandedDirs: new Set() }),

  expandAllDirs: () =>
    set((state) => {
      const dirs = new Set<string>();
      const walk = (nodes: FileEntry[]) => {
        for (const n of nodes) {
          if (n.isDir) {
            dirs.add(n.path);
            if (n.children) walk(n.children);
          }
        }
      };
      walk(state.fileTree);
      return { expandedDirs: dirs };
    }),

  setLoadError: (e) => set({ loadError: e }),

  retryLoadFileTree: async () => {
    const path = get().rootPath;
    if (!path) return;
    try {
      // Dynamic import: see the note above useFileStore for why this can't be static.
      const { _loadContextFileTree } =
        await import("../../services/vault-context-loader");
      await _loadContextFileTree(path);
    } catch {
      // §4.3 loadError state already reflects the failure; the retry button is
      // driven by that state, so swallow the rethrow here.
    }
  },

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
      const fileMtimes = new Map(state.fileMtimes);
      fileMtimes.delete(path);
      return { openFiles, fileMtimes };
    }),

  getFileMtime: (path) => get().fileMtimes.get(path),

  initFileMtime: (path) =>
    set((state) => {
      const fileMtimes = new Map(state.fileMtimes);
      fileMtimes.set(path, { lastSaveMtime: 0, canReloadMtime: 0 });
      return { fileMtimes };
    }),

  updateLastSaveMtime: (path, mtime) =>
    set((state) => {
      const fileMtimes = new Map(state.fileMtimes);
      const existing = fileMtimes.get(path) ?? {
        lastSaveMtime: 0,
        canReloadMtime: 0,
      };
      fileMtimes.set(path, { ...existing, lastSaveMtime: mtime });
      return { fileMtimes };
    }),

  updateCanReloadMtime: (path, mtime) =>
    set((state) => {
      const fileMtimes = new Map(state.fileMtimes);
      const existing = fileMtimes.get(path) ?? {
        lastSaveMtime: 0,
        canReloadMtime: 0,
      };
      fileMtimes.set(path, { ...existing, canReloadMtime: mtime });
      return { fileMtimes };
    }),

  renameFileEntry: (oldPath, newPath, newName) =>
    set((state) => ({
      openFiles: rekeyOpenFilesPrefix(state.openFiles, oldPath, newPath),
      fileTree: renameInTree(state.fileTree, oldPath, newPath, newName),
    })),

  addFileEntry: (parentPath, entry) =>
    set((state) => {
      // §4.5 Normalize modifiedAt at this single insert choke point (create
      // file/folder, duplicate, external drop, watcher-add) so mtime sort
      // places new entries correctly. Rust `modified_at` is epoch SECONDS
      // (duration.as_secs()), not milliseconds — mixing units would make new
      // files sort as absurdly-newer.
      const normalizedEntry: FileEntry =
        entry.modifiedAt == null
          ? { ...entry, modifiedAt: Math.floor(Date.now() / 1000) }
          : entry;

      return {
        fileTree: addToTree(
          state.fileTree,
          parentPath,
          state.rootPath,
          normalizedEntry,
          state.fileTreeSortOrder,
        ),
      };
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

      return { openFiles, fileTree: removeFromTree(state.fileTree, path) };
    }),

  moveFileEntry: (oldPath, newParentPath) =>
    set((state) => {
      const moved = moveInTree(
        state.fileTree,
        oldPath,
        newParentPath,
        state.rootPath,
        state.fileTreeSortOrder,
      );
      if (!moved) return state;

      return {
        openFiles: rekeyOpenFilesPrefix(
          state.openFiles,
          oldPath,
          moved.newPath,
        ),
        fileTree: moved.entries,
      };
    }),

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
    set({
      rootPath: null,
      fileTree: [],
      expandedDirs: new Set(),
      loadError: null,
    });

    // §81 Remove all contexts so the context tab bar clears.
    //
    // ‼️ One transition, not a per-context loop: a loop hands `activeContextId` down
    // the survivors, and the subscription at the bottom of this file turns each
    // hand-off into a `setRootPath` that undoes the `rootPath: null` just above —
    // leaving the empty-workspace surface instead of home. See `clearAllContexts`.
    useContextStore.getState().clearAllContexts();
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
