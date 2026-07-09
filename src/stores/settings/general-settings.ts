import type { CustomExportItem } from "../../ipc/types";
import type { StateCreator } from "zustand";

export interface GeneralSettingsSlice {
  addRecentFile: (path: string) => void;
  addRecentFolder: (path: string, isVault?: boolean) => void;
  autoSave: boolean;
  autoSaveDelay: number;
  autoUpdateLinks: boolean;
  clearRecent: () => void;
  customExports: CustomExportItem[];
  keybindingOverrides: Record<string, string>;
  lastOpenedFile: null | string;
  lastOpenedFolder: null | string;
  onLaunch: OnLaunch;
  pandocPath: string;
  recentFiles: RecentFileEntry[];
  recentFolders: RecentFolderEntry[];
  removeKeybindingOverride: (id: string) => void;
  removeRecentFile: (path: string) => void;
  removeRecentFolder: (path: string) => void;
  resetAllKeybindings: () => void;
  setAutoSave: (enabled: boolean) => void;
  setAutoSaveDelay: (delay: number) => void;
  setAutoUpdateLinks: (enabled: boolean) => void;
  setCustomExports: (items: CustomExportItem[]) => void;
  setKeybindingOverride: (id: string, key: string) => void;
  setLastOpenedFile: (path: null | string) => void;
  setLastOpenedFolder: (path: null | string) => void;
  setOnLaunch: (onLaunch: OnLaunch) => void;
  setPandocPath: (path: string) => void;
  setShowWelcome: (show: boolean) => void;
  setSnapshotInterval: (minutes: number) => void;
  setSnapshotMaxCount: (count: number) => void;
  setWikilinkFormat: (format: WikilinkFormat) => void;
  setWordTemplatePath: (path: string) => void;
  showWelcome: boolean;
  snapshotInterval: number;
  snapshotMaxCount: number;
  wikilinkFormat: WikilinkFormat;
  wordTemplatePath: string;
}

export interface RecentFileEntry {
  lastOpened: number;
  path: string;
}

export interface RecentFolderEntry {
  isVault?: boolean;
  lastOpened: number;
  path: string;
}

type OnLaunch = "newFile" | "restoreLastFile" | "restoreLastFolder";

type WikilinkFormat = "markdown" | "wikilink";

export const createGeneralSettingsSlice: StateCreator<
  GeneralSettingsSlice,
  [],
  [],
  GeneralSettingsSlice
> = (set) => ({
  // General
  onLaunch: "restoreLastFolder",
  autoSave: true,
  autoSaveDelay: 2000,
  showWelcome: true,
  recentFolders: [],
  recentFiles: [],
  lastOpenedFolder: null,
  lastOpenedFile: null,

  // Files & Links
  wikilinkFormat: "wikilink",
  autoUpdateLinks: true,

  // §55 Pandoc Extended Export
  pandocPath: "pandoc",
  wordTemplatePath: "",
  customExports: [],

  // Snapshots (§71)
  snapshotInterval: 30,
  snapshotMaxCount: 50,

  // Keybinding overrides
  keybindingOverrides: {},

  // General setters
  setOnLaunch: (onLaunch) => set({ onLaunch }),
  setAutoSave: (autoSave) => set({ autoSave }),
  setAutoSaveDelay: (autoSaveDelay) => set({ autoSaveDelay }),
  setShowWelcome: (showWelcome) => set({ showWelcome }),

  addRecentFolder: (path, isVault) =>
    set((state) => {
      const prev = state.recentFolders.find((f) => f.path === path);
      const filtered = state.recentFolders.filter((f) => f.path !== path);
      // On re-add without an explicit flag, preserve the previously known value.
      const resolvedIsVault = isVault ?? prev?.isVault;
      return {
        recentFolders: [
          { path, lastOpened: Date.now(), isVault: resolvedIsVault },
          ...filtered,
        ].slice(0, 5),
        lastOpenedFolder: path,
      };
    }),

  addRecentFile: (path) =>
    set((state) => {
      const filtered = state.recentFiles.filter((f) => f.path !== path);
      return {
        recentFiles: [{ path, lastOpened: Date.now() }, ...filtered].slice(
          0,
          10,
        ),
        lastOpenedFile: path,
      };
    }),

  removeRecentFolder: (path) =>
    set((state) => ({
      recentFolders: state.recentFolders.filter((f) => f.path !== path),
    })),

  removeRecentFile: (path) =>
    set((state) => ({
      recentFiles: state.recentFiles.filter((f) => f.path !== path),
    })),

  clearRecent: () => set({ recentFolders: [], recentFiles: [] }),

  setLastOpenedFolder: (path) => set({ lastOpenedFolder: path }),
  setLastOpenedFile: (path) => set({ lastOpenedFile: path }),

  // Files setters
  setWikilinkFormat: (wikilinkFormat) => set({ wikilinkFormat }),
  setAutoUpdateLinks: (autoUpdateLinks) => set({ autoUpdateLinks }),

  // Export setters
  setPandocPath: (pandocPath) => set({ pandocPath }),
  setWordTemplatePath: (wordTemplatePath) => set({ wordTemplatePath }),
  setCustomExports: (customExports) => set({ customExports }),

  // Snapshot setters
  setSnapshotInterval: (snapshotInterval) => set({ snapshotInterval }),
  setSnapshotMaxCount: (snapshotMaxCount) => set({ snapshotMaxCount }),

  // Keybinding setters
  setKeybindingOverride: (id, key) =>
    set((s) => ({
      keybindingOverrides: { ...s.keybindingOverrides, [id]: key },
    })),
  removeKeybindingOverride: (id) =>
    set((s) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _removed, ...rest } = s.keybindingOverrides;
      return { keybindingOverrides: rest };
    }),
  resetAllKeybindings: () => set({ keybindingOverrides: {} }),
});
