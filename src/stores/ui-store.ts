// §3.5 UI 레이아웃 스토어
import { create } from "zustand";
import { useSettingsStore } from "./settings-store";

type SidebarPanel = "files" | "outline" | "search" | "backlinks" | "bookmarks" | "graph";
type ExportFormat = "html" | "pdf";

interface UIState {
  sidebarOpen: boolean;
  sidebarPanel: SidebarPanel;
  sidebarWidth: number;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  rightPanelMode: "chat" | "none";
  commandPaletteOpen: boolean;
  quickSwitcherOpen: boolean;
  settingsOpen: boolean;
  aboutOpen: boolean;
  exportDialogOpen: boolean;
  exportFormat: ExportFormat;
  welcomeOpen: boolean;
  newSkillDialogOpen: boolean;
  skillGeneratorDialogOpen: boolean;
  skillTestDialogOpen: boolean;
  pendingApplyContent: string | null;

  toggleSidebar: () => void;
  setSidebarPanel: (panel: SidebarPanel) => void;
  setSidebarWidth: (width: number) => void;
  toggleRightPanel: () => void;
  setRightPanelWidth: (width: number) => void;
  setRightPanelMode: (mode: "chat" | "none") => void;
  toggleCommandPalette: () => void;
  toggleQuickSwitcher: () => void;
  toggleSettings: () => void;
  toggleAbout: () => void;
  openExportDialog: (format?: ExportFormat) => void;
  closeExportDialog: () => void;
  dismissWelcome: (permanent?: boolean) => void;
  toggleNewSkillDialog: () => void;
  toggleSkillGeneratorDialog: () => void;
  toggleSkillTestDialog: () => void;
  setPendingApplyContent: (content: string | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  sidebarPanel: "files",
  sidebarWidth: 260,
  rightPanelOpen: false,
  rightPanelWidth: 300,
  rightPanelMode: "chat" as const,
  commandPaletteOpen: false,
  quickSwitcherOpen: false,
  settingsOpen: false,
  aboutOpen: false,
  exportDialogOpen: false,
  exportFormat: "html" as ExportFormat,
  welcomeOpen: useSettingsStore.getState().showWelcome,
  newSkillDialogOpen: false,
  skillGeneratorDialogOpen: false,
  skillTestDialogOpen: false,
  pendingApplyContent: null,

  toggleSidebar: () =>
    set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  setSidebarPanel: (panel) => set({ sidebarPanel: panel }),

  setSidebarWidth: (width) => set({ sidebarWidth: width }),

  toggleRightPanel: () =>
    set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),

  setRightPanelWidth: (width) => set({ rightPanelWidth: width }),

  setRightPanelMode: (mode) => set({ rightPanelMode: mode }),

  toggleCommandPalette: () =>
    set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),

  toggleQuickSwitcher: () =>
    set((state) => ({ quickSwitcherOpen: !state.quickSwitcherOpen })),

  toggleSettings: () =>
    set((state) => ({ settingsOpen: !state.settingsOpen })),

  toggleAbout: () =>
    set((state) => ({ aboutOpen: !state.aboutOpen })),

  openExportDialog: (format) =>
    set({ exportDialogOpen: true, exportFormat: format ?? "html" }),

  closeExportDialog: () => set({ exportDialogOpen: false }),

  dismissWelcome: (permanent) => {
    if (permanent) {
      useSettingsStore.getState().setShowWelcome(false);
    }
    set({ welcomeOpen: false });
  },

  toggleNewSkillDialog: () =>
    set((state) => ({ newSkillDialogOpen: !state.newSkillDialogOpen })),

  toggleSkillGeneratorDialog: () =>
    set((state) => ({ skillGeneratorDialogOpen: !state.skillGeneratorDialogOpen })),

  toggleSkillTestDialog: () =>
    set((state) => ({ skillTestDialogOpen: !state.skillTestDialogOpen })),

  setPendingApplyContent: (pendingApplyContent) => set({ pendingApplyContent }),
}));
