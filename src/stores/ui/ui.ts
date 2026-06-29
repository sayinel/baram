// §3.5 UI 레이아웃 스토어
import { create } from "zustand";

export interface ConflictModalState {
  /** Snapshot of the common-ancestor content captured when the conflict was
   *  detected (before reading the external change) — used as the 3-way base. */
  base: string;
  externalMtime: number;
  filePath: string;
}

export type RightPanelMode =
  "chat" | "help" | "memories" | "none" | "photo-gallery" | "properties";

export type SidebarPanel =
  | "backlinks"
  | "bookmarks"
  | "calendar"
  | "files"
  | "git"
  | "graph"
  | "outline"
  | "plugins"
  | "search"
  | "skills-gallery"
  | "snapshots"
  | "tags";

export interface ToastState {
  /** Monotonic id — changing it restarts the auto-dismiss timer */
  id: number;
  message: string;
}

type ExportFormat =
  "docx" | "epub" | "html" | "latex" | "notion" | "pdf" | "rst";

interface UIState {
  aboutOpen: boolean;
  /** §Phase5: Close the conflict modal (without resolution — used internally) */
  closeConflictModal: () => void;
  closeExportDialog: () => void;
  commandPaletteOpen: boolean;
  /** §Phase5: External file change conflict modal state (null = closed) */
  conflictModal: ConflictModalState | null;
  /** When true, cursor moves to end of document after reload (e.g. Quick Capture append) */
  contentReloadCursorEnd: boolean;
  /** Monotonic counter — incremented after Global Search Replace / Quick Capture to signal editor reload */
  contentReloadVersion: number;
  /** Dismiss the transient toast */
  dismissToast: () => void;
  exportDialogOpen: boolean;
  exportFormat: ExportFormat;
  /** §Phase5: Open the conflict modal for a file that changed externally while dirty */
  openConflictModal: (
    filePath: string,
    externalMtime: number,
    base: string,
  ) => void;
  openExportDialog: (format?: ExportFormat) => void;
  openQuickCapture: (type?: "idea" | "link" | "note" | "quote") => void;
  pendingApplyContent: null | string;
  pendingSearchHighlight: null | string;
  quickCaptureOpen: boolean;
  quickCaptureType: "idea" | "link" | "note" | "quote";
  quickSwitcherOpen: boolean;
  rightPanelMode: RightPanelMode;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  setPendingApplyContent: (content: null | string) => void;
  setPendingSearchHighlight: (term: null | string) => void;
  setRightPanelMode: (mode: RightPanelMode) => void;

  setRightPanelWidth: (width: number) => void;
  setSidebarPanel: (panel: SidebarPanel) => void;
  setSidebarWidth: (width: number) => void;
  settingsOpen: boolean;
  /** Show a transient toast (auto-dismisses after a few seconds) */
  showToast: (message: string) => void;
  sidebarOpen: boolean;
  sidebarPanel: SidebarPanel;
  sidebarWidth: number;
  skillGeneratorDialogOpen: boolean;
  skillTestDialogOpen: boolean;
  smartTemplateDialogOpen: boolean;
  /** Transient toast notification (null = hidden) */
  toast: null | ToastState;
  toggleAbout: () => void;
  toggleCommandPalette: () => void;
  toggleQuickCapture: () => void;
  toggleQuickSwitcher: () => void;
  toggleRightPanel: () => void;
  toggleSettings: () => void;
  toggleSidebar: () => void;
  toggleSkillGeneratorDialog: () => void;
  toggleSkillTestDialog: () => void;
  toggleSmartTemplateDialog: () => void;
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
  conflictModal: null,
  exportDialogOpen: false,
  exportFormat: "html" as ExportFormat,
  skillGeneratorDialogOpen: false,
  skillTestDialogOpen: false,
  smartTemplateDialogOpen: false,
  pendingApplyContent: null,
  quickCaptureOpen: false,
  quickCaptureType: "note" as const,
  pendingSearchHighlight: null,
  contentReloadVersion: 0,
  contentReloadCursorEnd: false,

  openConflictModal: (filePath, externalMtime, base) =>
    set({ conflictModal: { base, externalMtime, filePath } }),

  closeConflictModal: () => set({ conflictModal: null }),

  toast: null,

  showToast: (message) =>
    set((state) => ({ toast: { id: (state.toast?.id ?? 0) + 1, message } })),

  dismissToast: () => set({ toast: null }),

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

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

  toggleSettings: () => set((state) => ({ settingsOpen: !state.settingsOpen })),

  toggleAbout: () => set((state) => ({ aboutOpen: !state.aboutOpen })),

  openExportDialog: (format) =>
    set({ exportDialogOpen: true, exportFormat: format ?? "html" }),

  closeExportDialog: () => set({ exportDialogOpen: false }),

  toggleSkillGeneratorDialog: () =>
    set((state) => ({
      skillGeneratorDialogOpen: !state.skillGeneratorDialogOpen,
    })),

  toggleSkillTestDialog: () =>
    set((state) => ({ skillTestDialogOpen: !state.skillTestDialogOpen })),

  toggleSmartTemplateDialog: () =>
    set((state) => ({
      smartTemplateDialogOpen: !state.smartTemplateDialogOpen,
    })),

  toggleQuickCapture: () =>
    set((state) => ({ quickCaptureOpen: !state.quickCaptureOpen })),

  openQuickCapture: (type) =>
    set({ quickCaptureOpen: true, quickCaptureType: type ?? "note" }),

  setPendingApplyContent: (pendingApplyContent) => set({ pendingApplyContent }),

  setPendingSearchHighlight: (pendingSearchHighlight) =>
    set({ pendingSearchHighlight }),

  triggerContentReload: (cursorEnd?: boolean) =>
    set((state) => ({
      contentReloadVersion: state.contentReloadVersion + 1,
      contentReloadCursorEnd: cursorEnd ?? false,
    })),
}));
