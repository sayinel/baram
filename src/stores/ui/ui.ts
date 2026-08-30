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
  | "tasks"
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
 *  close/quit (all dirty tabs); `closeTab` = closing a single tab; `reload` =
 *  View > Reload / CmdOrCtrl+R (§479, all dirty tabs — reload discards every
 *  open tab, not just the active one, so it saves the same set as quit). */
export type UnsavedModalRequest =
  | { intent: "closeTab"; tabId: string }
  | { intent: "quit" }
  | { intent: "reload" };

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
  closeTaskEdit: () => void;
  /** §close-guard: Close the shared unsaved-changes modal */
  closeUnsavedModal: () => void;
  closeWeeklyReview: () => void;
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
  /** §313 전역 단축키로 여는 길 — 캡처창을 **태스크 모드로** 연다 */
  openQuickCaptureForTask: () => void;
  /** M2-b4 태스크 편집 모달 */
  openTaskEdit: () => void;
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
  /**
   * §314 AI가 뽑은 액션 아이템. `pendingApplyContent`와 나란한 통로이지만 뜻이 다르다 —
   * 저쪽은 선택을 **대체**하고 이쪽은 선택 **아래에 덧붙인다**. 회의록에서 할 일을 뽑는
   * 일이라 원문이 살아 있어야 한다.
   */
  pendingInsertTasks: null | string;
  pendingSearchHighlight: null | string;
  quickCaptureOpen: boolean;
  /** §313 이번 열기가 태스크를 잡으려는 것인가 — 여는 쪽이 정하고, 닫히면 사라진다 */
  quickCaptureTaskIntent: boolean;
  quickSwitcherOpen: boolean;
  rightPanelMode: RightPanelMode;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  setPdfRailTab: (tab: PdfRailTab) => void;
  setPendingApplyContent: (content: null | string) => void;
  setPendingInsertTasks: (tasks: null | string) => void;
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
  /** M2-b4 태스크 편집 모달이 열려 있는가 */
  taskEditOpen: boolean;
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
  /** §315 주간 리뷰 화면 — 아젠다 헤더 버튼과 커맨드 팔레트가 연다 */
  toggleWeeklyReview: () => void;
  triggerContentReload: (cursorEnd?: boolean) => void;
  /** §close-guard: Shared unsaved-changes modal request (null = closed) */
  unsavedModal: null | UnsavedModalRequest;
  vimStatus: null | VimStatus;
  weeklyReviewOpen: boolean;
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
  pendingInsertTasks: null,
  quickCaptureOpen: false,
  quickCaptureTaskIntent: false,
  taskEditOpen: false,
  weeklyReviewOpen: false,
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

  // ‼️ 두 경로 모두 intent를 **명시적으로 끈다.** 켜고 끄는 곳이 갈리면 전역 단축키로
  // 한 번 연 뒤의 평범한 ⌘⇧N이 태스크 모드로 열린다 — §307D가 없애려던 "끈적이는 숨은
  // 모드"가 다른 문으로 돌아오는 셈이다.
  toggleQuickCapture: () =>
    set((state) => ({
      quickCaptureOpen: !state.quickCaptureOpen,
      quickCaptureTaskIntent: false,
    })),

  openQuickCapture: () =>
    set({ quickCaptureOpen: true, quickCaptureTaskIntent: false }),

  // §313 전역 캡처는 태스크를 잡으려고 누르는 키다 — 설정이 태스크 항목이고 이름이
  // 그렇게 말한다. 여기서 모드를 켜 주지 않으면 사용자는 백그라운드에서 불러낸 창에서
  // 체크박스를 한 번 더 눌러야 하고, 잊으면 fleeting note가 하나 생긴다.
  openQuickCaptureForTask: () =>
    set({ quickCaptureOpen: true, quickCaptureTaskIntent: true }),

  // 토글이 아니다 — 이 모달은 커서가 있는 블록을 대상으로 열리므로, 열려 있는 동안
  // 같은 키를 다시 눌러 "다른 블록으로 옮겨 여는" 일이 있을 수 없다(포커스가 모달에
  // 있어 커서가 움직이지 않는다).
  openTaskEdit: () => set({ taskEditOpen: true }),
  closeTaskEdit: () => set({ taskEditOpen: false }),

  // §315 토글이다 — 커맨드 팔레트에서 같은 커맨드를 다시 실행하면 닫힌다. 리뷰는
  // 훑는 화면이라 "열려 있는데 또 열기"가 자연스러운 조작이 아니다.
  toggleWeeklyReview: () =>
    set((state) => ({ weeklyReviewOpen: !state.weeklyReviewOpen })),

  closeWeeklyReview: () => set({ weeklyReviewOpen: false }),

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
  setPendingInsertTasks: (pendingInsertTasks) => set({ pendingInsertTasks }),

  setPendingSearchHighlight: (pendingSearchHighlight) =>
    set({ pendingSearchHighlight }),

  triggerContentReload: (cursorEnd?: boolean) =>
    set((state) => ({
      contentReloadVersion: state.contentReloadVersion + 1,
      contentReloadCursorEnd: cursorEnd ?? false,
    })),
}));
