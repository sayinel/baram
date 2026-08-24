// §3.5 UI 레이아웃 스토어
import { create } from "zustand";

export interface ConflictModalState {
  /** Snapshot of the common-ancestor content captured when the conflict was
   *  detected (before reading the external change) — used as the 3-way base. */
  base: string;
  externalMtime: number;
  filePath: string;
}

export type ExportFormat =
  "docx" | "epub" | "html" | "latex" | "notion" | "pdf" | "rst";

/**
 * §282 PDF 사이드 레일이 보여주는 목록. 레일은 PDF 탭에서만 렌더되지만 상태가
 * 여기 사는 이유는 RightPanelMode/SidebarPanel과 같다 — PdfPreview는 탭을
 * 바꿀 때마다 언마운트되므로, 컴포넌트 state에 두면 탭을 오갈 때마다 레일이
 * 닫힌다. 이 스토어는 persist를 쓰지 않으므로 세션 범위다(앱을 다시 켜면
 * 닫힌 상태로 시작한다). 재시작까지 살리려면 settings 스토어 버전 범프 +
 * 백필 마이그레이션이 필요하다 — 지금은 그 비용을 지지 않는다.
 */
export type PdfRailTab = "highlights" | "pages";

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
  // "plugin" (singular) = host slot for the active plugin-CONTRIBUTED panel
  // (resolved via plugin-ui-store.activePluginPanelId). "plugins" (plural) =
  // the built-in plugin manager/marketplace. Do NOT confuse the two.
  | "plugin"
  | "plugins"
  | "search"
  | "skills-gallery"
  | "snapshots"
  | "tags"
  | "zettel";

export interface ToastState {
  /** Monotonic id — changing it restarts the auto-dismiss timer */
  id: number;
  message: string;
  /**
   * §260 Phase 4a — who is speaking, when it is not the app. Rendered as its OWN
   * element (see `ToastHost`), never concatenated into `message`: a sandboxed plugin
   * supplies the message, so a prefix inside that string is a prefix the plugin
   * controls. The security review found `name: "Baram"` made a plugin's toast
   * indistinguishable from the app's own.
   */
  source?: string;
  type?: "error" | "info" | "warning";
}

/** §close-guard: What triggered the shared unsaved-changes modal. `quit` = app
 *  close/quit (all dirty tabs); `closeTab` = closing a single tab. */
export type UnsavedModalRequest =
  { intent: "closeTab"; tabId: string } | { intent: "quit" };

/** §298 vim §8 — one atomic status: which SURFACE owns the indicator. */
export interface VimStatus {
  /** Ex line being typed, colon included (":w") — absent when none is open.
   *  vim shows the command line INSTEAD of the mode indicator. */
  command?: string;
  /** Focused non-vim island's label ("math", "mermaid", …) — rendered as
   *  `-- INSERT (math) --` so the mode line stays honest while an island
   *  owns the keys (§8). Absent for plain surface modes. */
  island?: string;
  mode: VimStatusMode;
  surface: "codeblock" | "source" | "wysiwyg";
}

/** §298 vim S3 — current vim mode shown in the StatusBar (null = vim off or
 *  not in source mode). Mirrors vim-ime-guard's VimModeName; defined here
 *  because ui.ts is the canonical home for UI-facing unions. */
export type VimStatusMode = "insert" | "normal" | "replace" | "visual";

interface UIState {
  aboutOpen: boolean;
  /** §Phase5: Close the conflict modal (without resolution — used internally) */
  closeConflictModal: () => void;
  closeExportDialog: () => void;
  /** §close-guard: Close the shared unsaved-changes modal */
  closeUnsavedModal: () => void;
  closeZettelTitleDialog: () => void;
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
  openQuickCapture: () => void;
  /** §close-guard: Open the shared unsaved-changes modal (quit or single tab) */
  openUnsavedModal: (req: UnsavedModalRequest) => void;
  openZettelTitleDialog: (opts: {
    confirmLabel: string;
    description?: string;
    initialTitle?: string;
    onSubmit: (title: string) => void;
    title: string;
  }) => void;
  /** §282 PDF 사이드 레일이 열려 있는가. */
  pdfRailOpen: boolean;
  /** §282 레일에서 보고 있는 목록. */
  pdfRailTab: PdfRailTab;
  pendingApplyContent: null | string;
  pendingSearchHighlight: null | string;
  quickCaptureOpen: boolean;
  quickSwitcherOpen: boolean;
  rightPanelMode: RightPanelMode;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  setPdfRailTab: (tab: PdfRailTab) => void;
  setPendingApplyContent: (content: null | string) => void;
  setPendingSearchHighlight: (term: null | string) => void;
  setRightPanelMode: (mode: RightPanelMode) => void;
  setRightPanelWidth: (width: number) => void;

  setSidebarPanel: (panel: SidebarPanel) => void;
  setSidebarWidth: (width: number) => void;
  settingsOpen: boolean;
  /** §298 vim S3 — fed by SourceCodeEditor's vim controller */
  setVimStatus: (status: null | VimStatus) => void;
  /** Show a transient toast (auto-dismisses after a few seconds) */
  showToast: (
    message: string,
    type?: "error" | "info" | "warning",
    source?: string,
  ) => void;
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
  togglePdfRail: () => void;
  toggleQuickCapture: () => void;
  toggleQuickSwitcher: () => void;
  toggleRightPanel: () => void;
  toggleSettings: () => void;
  toggleSidebar: () => void;
  toggleSkillGeneratorDialog: () => void;
  toggleSkillTestDialog: () => void;
  toggleSmartTemplateDialog: () => void;
  triggerContentReload: (cursorEnd?: boolean) => void;
  /** §close-guard: Shared unsaved-changes modal request (null = closed) */
  unsavedModal: null | UnsavedModalRequest;
  vimStatus: null | VimStatus;
  /** §94: Inline title-input dialog (WKWebView has no window.prompt) */
  zettelTitleDialog: {
    /** Confirm-button label (e.g. "Create" | "Promote") */
    confirmLabel: string;
    /** One-line explanation of what the action does */
    description?: string;
    /** Prefill text (e.g. §94 new-from-selection's derived title) */
    initialTitle: string;
    onSubmit: ((title: string) => void) | null;
    open: boolean;
    /** Dialog header (e.g. "Promote to Permanent Note") */
    title: string;
  };
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
  exportFormat: "pdf" as ExportFormat,
  skillGeneratorDialogOpen: false,
  skillTestDialogOpen: false,
  smartTemplateDialogOpen: false,
  pdfRailOpen: false,
  pdfRailTab: "pages" as const,
  pendingApplyContent: null,
  quickCaptureOpen: false,
  unsavedModal: null,
  vimStatus: null,
  pendingSearchHighlight: null,
  contentReloadVersion: 0,
  contentReloadCursorEnd: false,
  zettelTitleDialog: {
    open: false,
    onSubmit: null,
    initialTitle: "",
    title: "",
    confirmLabel: "Create",
  },

  openConflictModal: (filePath, externalMtime, base) =>
    set({ conflictModal: { base, externalMtime, filePath } }),

  closeConflictModal: () => set({ conflictModal: null }),

  toast: null,

  showToast: (message, type, source) =>
    set((state) => ({
      toast: { id: (state.toast?.id ?? 0) + 1, message, source, type },
    })),

  dismissToast: () => set({ toast: null }),

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  setSidebarPanel: (panel) => set({ sidebarPanel: panel }),

  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setVimStatus: (status) => set({ vimStatus: status }),

  toggleRightPanel: () =>
    set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),

  setRightPanelWidth: (width) => set({ rightPanelWidth: width }),

  setRightPanelMode: (mode) => set({ rightPanelMode: mode }),

  togglePdfRail: () => set((state) => ({ pdfRailOpen: !state.pdfRailOpen })),

  setPdfRailTab: (tab) => set({ pdfRailTab: tab }),

  toggleCommandPalette: () =>
    set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),

  toggleQuickSwitcher: () =>
    set((state) => ({ quickSwitcherOpen: !state.quickSwitcherOpen })),

  toggleSettings: () => set((state) => ({ settingsOpen: !state.settingsOpen })),

  toggleAbout: () => set((state) => ({ aboutOpen: !state.aboutOpen })),

  openExportDialog: (format) =>
    set({ exportDialogOpen: true, exportFormat: format ?? "pdf" }),

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

  openQuickCapture: () => set({ quickCaptureOpen: true }),

  openUnsavedModal: (req) => set({ unsavedModal: req }),

  closeUnsavedModal: () => set({ unsavedModal: null }),

  openZettelTitleDialog: (opts) =>
    set({
      zettelTitleDialog: {
        open: true,
        onSubmit: opts.onSubmit,
        initialTitle: opts.initialTitle ?? "",
        title: opts.title,
        description: opts.description,
        confirmLabel: opts.confirmLabel,
      },
    }),

  closeZettelTitleDialog: () =>
    set({
      zettelTitleDialog: {
        open: false,
        onSubmit: null,
        initialTitle: "",
        title: "",
        confirmLabel: "Create",
      },
    }),

  setPendingApplyContent: (pendingApplyContent) => set({ pendingApplyContent }),

  setPendingSearchHighlight: (pendingSearchHighlight) =>
    set({ pendingSearchHighlight }),

  triggerContentReload: (cursorEnd?: boolean) =>
    set((state) => ({
      contentReloadVersion: state.contentReloadVersion + 1,
      contentReloadCursorEnd: cursorEnd ?? false,
    })),
}));
