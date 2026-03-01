// §3.5 UI 레이아웃 스토어
import { create } from "zustand";
import { useSettingsStore } from "./settings-store";

type SidebarPanel = "files" | "outline" | "search" | "backlinks" | "bookmarks" | "graph" | "git" | "calendar" | "tags";
type ExportFormat = "html" | "pdf" | "notion" | "docx" | "latex" | "epub" | "rst";

interface UIState {
  sidebarOpen: boolean;
  sidebarPanel: SidebarPanel;
  sidebarWidth: number;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  rightPanelMode: "chat" | "help" | "memories" | "photo-gallery" | "none";
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
  quickCaptureOpen: boolean;
  quickCaptureType: "idea" | "link" | "quote" | "note";
  pendingSearchHighlight: string | null;
  /** Monotonic counter — incremented after Global Search Replace / Quick Capture to signal editor reload */
  contentReloadVersion: number;
  /** When true, cursor moves to end of document after reload (e.g. Quick Capture append) */
  contentReloadCursorEnd: boolean;

  toggleSidebar: () => void;
  setSidebarPanel: (panel: SidebarPanel) => void;
  setSidebarWidth: (width: number) => void;
  toggleRightPanel: () => void;
  setRightPanelWidth: (width: number) => void;
  setRightPanelMode: (mode: "chat" | "help" | "memories" | "photo-gallery" | "none") => void;
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
  toggleQuickCapture: () => void;
  openQuickCapture: (type?: "idea" | "link" | "quote" | "note") => void;
  setPendingApplyContent: (content: string | null) => void;
  setPendingSearchHighlight: (term: string | null) => void;
  triggerContentReload: (cursorEnd?: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  sidebarPanel: "files",
  sidebarWidth: 260,
  rightPanelOpen: false,
  rightPanelWidth: 360,
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
  quickCaptureOpen: false,
  quickCaptureType: "note" as const,
  pendingSearchHighlight: null,
  contentReloadVersion: 0,
  contentReloadCursorEnd: false,

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

  toggleQuickCapture: () =>
    set((state) => ({ quickCaptureOpen: !state.quickCaptureOpen })),

  openQuickCapture: (type) =>
    set({ quickCaptureOpen: true, quickCaptureType: type ?? "note" }),

  setPendingApplyContent: (pendingApplyContent) => set({ pendingApplyContent }),

  setPendingSearchHighlight: (pendingSearchHighlight) => set({ pendingSearchHighlight }),

  triggerContentReload: (cursorEnd?: boolean) =>
    set((state) => ({
      contentReloadVersion: state.contentReloadVersion + 1,
      contentReloadCursorEnd: cursorEnd ?? false,
    })),
}));
