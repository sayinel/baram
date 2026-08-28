// §3.5 파일 시스템 스토어
import { create } from "zustand";

import { type Locale, t } from "../../i18n";
import { getVaultConfigByPath, setVaultConfigByPath } from "../../ipc/context";
import {
  isFolderAccessDeniedError,
  listDir,
  refreshIndex,
  setVaultRoot,
} from "../../ipc/invoke";
import { logger } from "../../utils/logger";
import { useContextStore } from "../context/context";
import { useEditorStore } from "../editor/editor";
import { useLinkStore } from "../editor/link";
import { useSettingsStore } from "../settings/store";
import { useUIStore } from "../ui/ui";
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

  // Detect vault by loading .baram/config.json (bypasses check_vault).
  // Must run BEFORE setVaultRoot — setVaultRoot registers a legacy "folder"
  // context in Rust, and addContext's dedup would return it with wrong type.
  const { getVaultConfigByPath } = await import("../../ipc/context");
  let isVault = false;
  try {
    const cfg = await getVaultConfigByPath(path);
    isVault = cfg.vault !== undefined && cfg.vault !== null;
  } catch {
    // No .baram/config.json or parse error → folder
  }

  // Register context in frontend + Rust FIRST (with correct type)
  const added = await contextStore.addContext(
    isVault ? "vault" : "folder",
    path,
  );

  // §81 Update legacy VaultRootState AFTER addContext (so Rust dedup
  // finds the correctly-typed context we just registered)
  await setVaultRoot(path);

  // Explicitly activate the new context (addContext only auto-activates the first)
  contextStore._setActiveContextLocal(added.id);

  await _loadContextFileTree(path);

  // Update settings (§81 tag the recent entry with vault-ness detected above)
  useSettingsStore.getState().addRecentFolder(path, isVault);
}

// buildFileTree lives in ./file-tree-ops (pure tree algebra); re-exported
// below for existing callers (work-log.ts, wikilink-suggest.ts, use-navigation.ts).
export { buildFileTree };

/**
 * Open a folder: list its contents recursively, build tree, update store.
 * §81 M2: Does NOT remove existing contexts — supports multi-context.
 */
export async function openFolder(path: string): Promise<void> {
  const contextStore = useContextStore.getState();

  // Check if already open as a context
  const existing = contextStore.contexts.find((c) => c.path === path);
  // §82 Fix: for an already-open context (e.g. startup restore of the active
  // vault via use-app-startup.ts), derive isVault from the known context type
  // instead of defaulting to false — otherwise addRecentFolder(path, false)
  // below would clobber a previously-stored isVault: true (nullish
  // coalescing does not treat `false` as absent).
  let isVault = existing?.contextType === "vault";
  if (!existing) {
    // Detect vault via .baram/config.json (bypasses check_vault).
    // Must run BEFORE setVaultRoot to avoid Rust legacy "folder" dedup.
    const { getVaultConfigByPath } = await import("../../ipc/context");
    try {
      const cfg = await getVaultConfigByPath(path);
      isVault = cfg.vault !== undefined && cfg.vault !== null;
    } catch {
      // No .baram/config.json or parse error → folder
    }

    // Register context with correct type FIRST
    await contextStore
      .addContext(isVault ? "vault" : "folder", path)
      .catch((err) => {
        logger.warn("§81 openFolder: context registration failed", err);
      });
  } else {
    // Existing context (possibly persisted from previous session)
    // Use local-only activation to avoid IPC failure for stale IDs
    contextStore._setActiveContextLocal(existing.id);
  }

  // §81 Update legacy VaultRootState AFTER context registration
  await setVaultRoot(path);

  await _loadContextFileTree(path);

  // Update settings
  useSettingsStore.getState().addRecentFolder(path, isVault);
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

    // 3. Reload file tree + rebuild link index
    await _loadContextFileTree(ctx.path);
  } else {
    // FileContext: clear file tree
    useFileStore.getState().setRootPath(null as unknown as string);
    useFileStore.getState().setFileTree([]);
    useFileStore.getState().setLoadError(null);
  }
}

/**
 * §81 Internal: Load file tree and index for a context path.
 * Shared by openFolder, addFolder, and switchContext.
 */
let _loadingPath: null | string = null;

async function _loadContextFileTree(path: string): Promise<void> {
  // §81 Prevent concurrent loads for the same path only
  if (_loadingPath === path) return;
  _loadingPath = path;

  try {
    // §4.5 Load the persisted sort order before building the tree; fall back
    // to the DEFAULT order (not the previous vault's in-memory value) if the
    // config read fails or has no saved order, so each vault without its own
    // saved order renders with the default rather than inheriting whatever
    // the last-opened vault happened to use.
    let order: SortOrder = DEFAULT_SORT_ORDER;
    try {
      const cfg = await getVaultConfigByPath(path);
      const saved = cfg.fileTree?.sortOrder;
      if (
        saved === "name-asc" ||
        saved === "name-desc" ||
        saved === "mtime-asc" ||
        saved === "mtime-desc"
      ) {
        order = saved;
      }
    } catch (err) {
      // vault config unreadable → keep default order; tree load must not fail on this
      logger.debug(
        "§4.5 _loadContextFileTree: vault config read failed, using default sort",
        err,
      );
    }
    useFileStore.setState({ fileTreeSortOrder: order });

    const entries = await listDir(path, true);
    const tree = buildFileTree(entries, path, order);
    useFileStore.getState().setRootPath(path);
    useFileStore.getState().setFileTree(tree);
    useFileStore.getState().setLoadError(null); // §4.3 clear prior error on success

    // Build link index in background
    refreshIndex(path)
      .then(() => useLinkStore.getState().invalidate())
      .catch((err) =>
        logger.warn("§81 _loadContextFileTree: refreshIndex failed", err),
      );
  } catch (err) {
    // §4.3 Surface the failure instead of silently leaving an empty tree.
    useFileStore.getState().setRootPath(path); // keep context so the panel renders in place
    useFileStore.getState().setFileTree([]);
    const { locale } = useSettingsStore.getState();
    if (isFolderAccessDeniedError(err)) {
      useFileStore.getState().setLoadError({ kind: "permission-denied", path });
      useUIStore
        .getState()
        .showToast(t("fileTree.accessDenied.toast", locale as Locale), "error");
    } else {
      const message = err instanceof Error ? err.message : String(err);
      useFileStore.getState().setLoadError({ kind: "generic", path, message });
      useUIStore
        .getState()
        .showToast(
          t("fileTree.accessDenied.toastGeneric", locale as Locale),
          "error",
        );
    }
    logger.warn("§4.3 _loadContextFileTree: load failed", err);
    throw err; // §4.3 preserve original resolve/reject contract for openFolder/addFolder/switchContext
  } finally {
    _loadingPath = null;
  }
}

/**
 * §4.5 Persist the active sort order to `.baram/config.json` (read-merge-write).
 * Fire-and-forget: failures are non-fatal since the sort still applies in-session.
 */
async function persistSortOrder(
  vaultPath: string,
  order: SortOrder,
): Promise<void> {
  try {
    const current = await getVaultConfigByPath(vaultPath);
    await setVaultConfigByPath(vaultPath, {
      ...current,
      fileTree: { ...current.fileTree, sortOrder: order },
    });
  } catch {
    // non-fatal: sort still applies in-session
  }
}

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
    // persist to vault config (fire-and-forget; merge with existing config)
    void persistSortOrder(rootPath, order);
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
