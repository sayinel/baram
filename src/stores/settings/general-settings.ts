import type { CustomExportItem } from "../../ipc/types";
import type { StateCreator } from "zustand";

export interface GeneralSettingsSlice {
  addRecentFile: (path: string) => void;
  addRecentFolder: (path: string) => void;
  autoSave: boolean;
  autoSaveDelay: number;
  autoUpdateLinks: boolean;
  customExports: CustomExportItem[];
  keybindingOverrides: Record<string, string>;
  lastOpenedFile: null | string;
  lastOpenedFolder: null | string;
  onLaunch: OnLaunch;
  pandocPath: string;
  recentFiles: { lastOpened: number; path: string }[];
  recentFolders: { lastOpened: number; path: string }[];
  removeKeybindingOverride: (id: string) => void;
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

  addRecentFolder: (path) =>
    set((state) => {
      const filtered = state.recentFolders.filter((f) => f.path !== path);
      return {
        recentFolders: [{ path, lastOpened: Date.now() }, ...filtered].slice(
          0,
          5,
        ),
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
