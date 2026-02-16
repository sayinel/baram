// §3.5 UI 레이아웃 스토어
import { create } from "zustand";

type SidebarPanel = "files" | "outline" | "search" | "backlinks";
type ExportFormat = "html" | "pdf";

interface UIState {
  sidebarOpen: boolean;
  sidebarPanel: SidebarPanel;
  sidebarWidth: number;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  commandPaletteOpen: boolean;
  settingsOpen: boolean;
  exportDialogOpen: boolean;
  exportFormat: ExportFormat;

  toggleSidebar: () => void;
  setSidebarPanel: (panel: SidebarPanel) => void;
  setSidebarWidth: (width: number) => void;
  toggleRightPanel: () => void;
  setRightPanelWidth: (width: number) => void;
  toggleCommandPalette: () => void;
  toggleSettings: () => void;
  openExportDialog: (format?: ExportFormat) => void;
  closeExportDialog: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  sidebarPanel: "files",
  sidebarWidth: 260,
  rightPanelOpen: false,
  rightPanelWidth: 300,
  commandPaletteOpen: false,
  settingsOpen: false,
  exportDialogOpen: false,
  exportFormat: "html" as ExportFormat,

  toggleSidebar: () =>
    set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  setSidebarPanel: (panel) => set({ sidebarPanel: panel }),

  setSidebarWidth: (width) => set({ sidebarWidth: width }),

  toggleRightPanel: () =>
    set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),

  setRightPanelWidth: (width) => set({ rightPanelWidth: width }),

  toggleCommandPalette: () =>
    set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),

  toggleSettings: () =>
    set((state) => ({ settingsOpen: !state.settingsOpen })),

  openExportDialog: (format) =>
    set({ exportDialogOpen: true, exportFormat: format ?? "html" }),

  closeExportDialog: () => set({ exportDialogOpen: false }),
}));
