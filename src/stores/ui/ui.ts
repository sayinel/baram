// §3.5 UI 레이아웃 스토어
import { create } from "zustand";

/**
 * §370.3 크롬 표면의 짧은 이름 → 그 표면을 담는 상태 필드.
 *
 * ‼️ **이름 공간이 둘이다.** 상태 필드는 `…Visible` 접미사를 달고(`statusBarVisible`),
 * 이 표의 키 — 그리고 테마 매니페스트의 `chrome` 키 — 는 접미사가 없다(`statusBar`).
 * 둘을 잇는 자리는 이 표 하나다. `` `${surface}Visible` `` 처럼 문자열로 조립하지 말
 * 것: 같은 부류의 사고가 `stores/file/workspace.ts` 의 `zettelkasten` 프리셋에 있다
 * (id 는 `zettelkasten` 인데 i18n 키는 `menu.workspace.zettel` 이라 조립이 틀린다).
 *
 * 매니페스트 쪽은 이 표를 import 하지 않고 자기 키를 따로 적는다 —
 * `themes/theme-manifest.ts` 는 스토어를 import 하지 않는 레이어이고, 그 성질을 이
 * 필드 하나 때문에 깨지 않는다. 두 목록이 어긋나는지는
 * `themes/__tests__/theme-manifest.test.ts` 의 parity 케이스가 런타임으로 본다.
 */
export const CHROME_SURFACE_FIELD = {
  activityBar: "activityBarVisible",
  statusBar: "statusBarVisible",
  tabBar: "tabBarVisible",
} as const;

/** 크롬 표면의 짧은 이름. 목록을 두 번 적지 않으려고 위 표의 키에서 파생한다
 *  (`RIGHT_PANEL_MODES` 와 같은 이유). */
export type ChromeSurface = keyof typeof CHROME_SURFACE_FIELD;

/** 위 표의 키 전부 — 표면을 순회하는 쪽이 읽는다. 오늘 읽는 곳은 이 파일의
 *  `revealAllChrome` · `proposeChromeVisibility` 와 매니페스트 parity 테스트다. */
export const CHROME_SURFACES = Object.keys(
  CHROME_SURFACE_FIELD,
) as ChromeSurface[];

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

// The array is the source of truth and the type is derived from it (rather than
// the other way around) so a runtime validator (`isRightPanelMode`) can exist
// without duplicating the member list — a duplicated list is exactly what goes
// stale the next time a mode is removed (§4.2, a persisted preset outliving the
// "help" mode it was saved with).
export const RIGHT_PANEL_MODES = [
  "chat",
  "memories",
  "none",
  "photo-gallery",
  "properties",
] as const;

export type RightPanelMode = (typeof RIGHT_PANEL_MODES)[number];

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
  /**
   * §324-a 토스트가 제안하는 단 하나의 행동 — "어디에 붙었는지 알리고 그리로 갈 수
   * 있게 한다".
   *
   * ‼️ 콜백이라는 형태가 이것을 앱 전용으로 만든다. 샌드박스 플러그인은
   * `sandbox/host-ui-bridge.ts`의 **3-인자** `showToast`로만 닿으므로 함수를 넘길
   * 통로가 없다 — `source` 배지가 문자열이라 위조가 가능했던 것과는 반대 상황이다.
   * `components/editor/__tests__/toast-action.test.tsx`가 그 경계를 계약으로 못 박는다.
   */
  action?: { label: string; onClick: () => void };
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

/** Validates a persisted `rightPanelMode` string against `RIGHT_PANEL_MODES` —
 *  see that array's comment for why it, not this function, is the source of truth. */
export function isRightPanelMode(value: unknown): value is RightPanelMode {
  return (RIGHT_PANEL_MODES as readonly unknown[]).includes(value);
}

/** §close-guard: What triggered the shared unsaved-changes modal. `quit` = app
 *  close/quit (all dirty tabs); `closeTab` = closing a single tab; `reload` =
 *  View > Reload / CmdOrCtrl+R (§479, all dirty tabs — reload discards every
 *  open tab, not just the active one, so it saves the same set as quit);
 *  `closeWorkspace` = §81 File > Close Workspace, which closes every tab and
 *  every context, so it too answers for all dirty tabs rather than the active one;
 *  `closeContext` = §82 closing one or more contexts (the tab bar's x, its context
 *  menu's Close and Close Others, Settings > Vault's remove), which answers only for
 *  the dirty tabs inside those contexts — saving the rest would write files the user
 *  never asked to touch. It carries a LIST because Close Others closes N at once and
 *  must ask once, not N times. */
export type UnsavedModalRequest =
  | { contextIds: string[]; intent: "closeContext" }
  | { intent: "closeTab"; tabId: string }
  | { intent: "closeWorkspace" }
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

/** 크롬 표면의 상태 필드 이름 — 위 표의 값들. 제안이 쓰는 partial 의 키 타입이다. */
type ChromeVisibilityField = (typeof CHROME_SURFACE_FIELD)[ChromeSurface];

interface UIState {
  aboutOpen: boolean;
  /** §370 크롬 표면의 표시 여부. 기본은 전부 보임 — 감추는 것은 늘 명시적 선택이다. */
  activityBarVisible: boolean;
  /**
   * §370.3 이번 세션에서 사용자가 **명시적으로** 토글한 표면.
   *
   * 테마의 제안은 여기 없는 표면에만 적용된다 — 그것이 "제안이지 강제가 아니다" 의
   * 실제 구현이다(`proposeChromeVisibility`). 세션 범위인 이유는 이 스토어 전체와
   * 같다(`PdfRailTab` 의 doc 주석이 그 계약을 적는다 — persist 를 쓰지 않는다):
   * 라이브 가시성이 재시작에 남지 않는데 그 이력만 남으면, 사용자가 만진 적 없는
   * 표면을 테마가 영영 못 건드린다.
   *
   * 기록하는 입구는 토글 셋과 `revealAllChrome` 뿐이다(이 파일에서 `markTouched`
   * 를 부르는 곳 전부 — 그 함수가 이 필드를 쓰는 유일한 통로다). 프리셋 적용
   * (`setChromeVisibility`)은 기록하지 **않는다** — 프리셋은 표면 하나가 아니라
   * 화면 전체를 고르는 행위라, 그것을 "이 표면을 손댔다" 로 세면 프리셋 한 번에
   * 모든 표면이 잠긴다. 제안 적용 자신도 기록하지 않는다 — 세면 두 번째 테마가
   * 영영 제안할 수 없다.
   */
  chromeTouched: Readonly<Partial<Record<ChromeSurface, true>>>;
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
  /**
   * §370.3 테마의 **제안**을 받는 입구. 프리셋 입구(`setChromeVisibility`)와 다른
   * 이유는 그쪽 주석과 같은 이유의 반대편이다 — 제안은 손대지 않은 표면만 옮기고,
   * 프리셋은 셋을 한꺼번에 정한다.
   *
   * 키는 `ChromeSurface`(접미사 없는 짧은 이름)이고, 선언하지 않은 표면은 건드리지
   * 않는다. 부르는 쪽은 `chrome-proposal.ts` 의 `applyThemeChrome` 하나다.
   */
  proposeChromeVisibility: (
    proposal: Readonly<Partial<Record<ChromeSurface, boolean>>>,
  ) => void;
  quickCaptureOpen: boolean;
  /** §313 이번 열기가 태스크를 잡으려는 것인가 — 여는 쪽이 정하고, 닫히면 사라진다 */
  quickCaptureTaskIntent: boolean;
  quickSwitcherOpen: boolean;
  /**
   * §370.2 숨은 크롬을 한 번에 되살린다 — 포인터·키보드 복귀 경로가 부르는 입구다.
   *
   * 토글 셋이 아니라 별도 액션인 이유: 의도가 "뒤집는다" 가 아니라 "전부 보이게
   * 한다" 이다. 오늘은 버튼이 셋 다 숨었을 때만 떠서 결과가 같지만, 그 조건이
   * 바뀌면 뒤집기는 켜야 할 것을 끈다.
   *
   * ‼️ 이것은 **사용자의 명시적 선택**이므로 세 표면을 전부 `chromeTouched` 에
   * 기록한다. 기록하지 않으면 사용자가 크롬을 되살린 직후 테마가 다시 감출 수
   * 있고, 그것은 §370.3 의 "제안이지 강제가 아니다" 를 어긴다. 프리셋 입구
   * (`setChromeVisibility`)와는 반대다 — 그쪽은 기록하지 않는다.
   */
  revealAllChrome: () => void;
  rightPanelMode: RightPanelMode;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  /**
   * §370 프리셋이 크롬 가시성을 한 번에 적용하는 입구. 사용자의 개별 토글과
   * **다른 입구다** — 토글은 "사용자가 이 표면을 손댔다"를 `chromeTouched` 에
   * 기록하고 프리셋 적용은 기록하지 않기 때문이다(§370.3). 입구가 하나면
   * 그 구분을 호출자에게 되물어야 한다.
   */
  setChromeVisibility: (next: {
    activityBarVisible: boolean;
    statusBarVisible: boolean;
    tabBarVisible: boolean;
  }) => void;
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
    action?: { label: string; onClick: () => void },
  ) => void;
  sidebarOpen: boolean;
  sidebarPanel: SidebarPanel;
  sidebarWidth: number;
  skillGeneratorDialogOpen: boolean;
  skillTestDialogOpen: boolean;
  smartTemplateDialogOpen: boolean;
  /** §370 크롬 표면의 표시 여부. 기본은 전부 보임 — 감추는 것은 늘 명시적 선택이다. */
  statusBarVisible: boolean;
  /** §370 크롬 표면의 표시 여부. 기본은 전부 보임 — 감추는 것은 늘 명시적 선택이다. */
  tabBarVisible: boolean;
  /** M2-b4 태스크 편집 모달이 열려 있는가 */
  taskEditOpen: boolean;
  /** Transient toast notification (null = hidden) */
  toast: null | ToastState;
  toggleAbout: () => void;
  /** §370 크롬 표면 토글 — `setChromeVisibility`와 다른 입구다(위 주석 참조). */
  toggleActivityBar: () => void;
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
  /** §370 크롬 표면 토글 — `setChromeVisibility`와 다른 입구다(위 주석 참조). */
  toggleStatusBar: () => void;
  /** §370 크롬 표면 토글 — `tabBarVisible`이 지배하는 것은 **파일 탭 바**뿐이다
   *  (ContextTabBar는 별개, 이 계획의 범위 밖). `setChromeVisibility`와 다른 입구다. */
  toggleTabBar: () => void;
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

/**
 * §370.3 손댐 기록을 덧댄다. 이미 전부 기록돼 있으면 **같은 객체**를 돌려준다 —
 * 그래야 호출자가 "바뀐 것이 없다" 를 참조 비교로 판정할 수 있고, 값이 같은 write 로
 * `chromeTouched` 셀렉터를 깨우지 않는다(CLAUDE.md 의 동등성 관문).
 */
function markTouched(
  prev: Readonly<Partial<Record<ChromeSurface, true>>>,
  surfaces: readonly ChromeSurface[],
): Readonly<Partial<Record<ChromeSurface, true>>> {
  const missing = surfaces.filter((surface) => !prev[surface]);
  if (missing.length === 0) return prev;
  const next = { ...prev };
  for (const surface of missing) next[surface] = true;
  return next;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  sidebarPanel: "files",
  sidebarWidth: 260,
  rightPanelOpen: false,
  rightPanelWidth: 360,
  rightPanelMode: "chat" as const,
  // §370 크롬 표면 — 기본은 전부 보임. `chromeTouched` 가 비어 있다는 것은 이번
  // 세션에 사용자가 어느 표면도 고른 적이 없다는 뜻이고, 그래서 테마가 제안할 수 있다.
  activityBarVisible: true,
  chromeTouched: {},
  statusBarVisible: true,
  tabBarVisible: true,
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

  showToast: (message, type, source, action) =>
    set((state) => ({
      toast: { action, id: (state.toast?.id ?? 0) + 1, message, source, type },
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

  setChromeVisibility: (next) =>
    set((state) => {
      if (
        state.activityBarVisible === next.activityBarVisible &&
        state.statusBarVisible === next.statusBarVisible &&
        state.tabBarVisible === next.tabBarVisible
      ) {
        return state;
      }
      return next;
    }),

  // §370 개별 토글 셋(아래 `toggleActivityBar`·`toggleStatusBar`·`toggleTabBar` 세
  // 함수만 지배 — 바로 다음의 `togglePdfRail`은 별개다) — `setChromeVisibility`
  // (프리셋 입구)와 끝까지 다른 입구로 남는다. §370.3이 이 셋에만 "사용자가 이
  // 표면을 손댔다"는 기록을 덧대므로, 여기서 `setChromeVisibility` 호출로
  // 구현하면 그 구분이 무너진다. 각자 **자기 키만** 기록한다.
  toggleActivityBar: () =>
    set((state) => ({
      activityBarVisible: !state.activityBarVisible,
      chromeTouched: markTouched(state.chromeTouched, ["activityBar"]),
    })),

  toggleStatusBar: () =>
    set((state) => ({
      chromeTouched: markTouched(state.chromeTouched, ["statusBar"]),
      statusBarVisible: !state.statusBarVisible,
    })),

  toggleTabBar: () =>
    set((state) => ({
      chromeTouched: markTouched(state.chromeTouched, ["tabBar"]),
      tabBarVisible: !state.tabBarVisible,
    })),

  // §370.2 복귀 경로 — 가장자리 호버/포커스 버튼(ChromeReveal)이 부른다. 토글이 아니라
  // "전부 보이게" 이므로 뒤집지 않는다(위 토글 셋과 다른 이유는 인터페이스의 §370.2
  // 주석 참조).
  //
  // §370.3 그리고 **셋 모두를 손댄 것으로 기록한다** — "크롬을 보이게 해라"는 셋에 대한
  // 명시적 선택이다. 기록하지 않으면 사용자가 되살린 직후 테마가 다시 감출 수 있고,
  // 그것이 §370.3이 금지한 강제다. 그래서 동등성 관문은 가시성만으로 판정하지 않는다:
  // 셋이 이미 보이면서 **기록까지 그대로일 때**만 아무것도 쓰지 않는다 — 셋이 보이지만
  // 기록이 없는 상태(기본 상태)에서 이것을 부르면 기록만 남긴다.
  revealAllChrome: () =>
    set((state) => {
      const chromeTouched = markTouched(state.chromeTouched, CHROME_SURFACES);
      if (
        state.activityBarVisible &&
        state.statusBarVisible &&
        state.tabBarVisible &&
        chromeTouched === state.chromeTouched
      ) {
        return state;
      }
      return {
        activityBarVisible: true,
        chromeTouched,
        statusBarVisible: true,
        tabBarVisible: true,
      };
    }),

  // §370.3 테마의 제안을 받는다. "제안이지 강제가 아니다"는 `chromeTouched` 를 보는
  // 아래 `continue` 한 줄로 구현된다 — 그 규칙을 아는 코드는 이 절 하나다
  // (`chromeTouched` 를 **읽는** 프로덕션 코드 전수, 2026-09-23).
  //
  // ‼️ 여기서는 손댐을 기록하지 않는다(인터페이스의 `chromeTouched` 주석의 표).
  proposeChromeVisibility: (proposal) =>
    set((state) => {
      const next: Partial<Record<ChromeVisibilityField, boolean>> = {};
      for (const surface of CHROME_SURFACES) {
        const proposed = proposal[surface];
        // 선언하지 않은 표면은 옮기지 않는다 — 모르는 것은 옮기지 않는다.
        if (proposed === undefined) continue;
        if (state.chromeTouched[surface]) continue;
        const field = CHROME_SURFACE_FIELD[surface];
        if (state[field] === proposed) continue;
        next[field] = proposed;
      }
      // 동등성 관문 — partial 은 새 root 가 되어 모든 리스너를 깨운다(CLAUDE.md).
      // 이 입구는 테마 전이마다 도는데, 그 대부분은 옮길 것이 없는 호출이다.
      if (Object.keys(next).length === 0) return state;
      return next;
    }),

  // §370과 무관 — PDF 사이드 레일은 크롬 표면이 아니다(§282).
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
