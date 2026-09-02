import type { JournalTheme } from "../../utils/journal/journal-themes";
import type { StateCreator } from "zustand";

/**
 * Floor for the Quick Capture editor's height, in px.
 *
 * §323 리뷰 Minor 6: 이 값은 `quick-capture.css`의 `.quick-capture-editor`
 * `min-height: 12rem`(= 192px)과 **같아야 한다**. 예전 바닥은 120이었고, 그
 * 사이 구간([120, 192))으로 드래그하면 설정에는 화면이 절대 보여줄 수 없는
 * 높이가 저장됐다 — CSS의 `min-height`가 인라인 height를 이기기 때문이다.
 * 상한 쪽에서 이미 한 번 고쳤던 "상태는 이렇다는데 화면은 저렇다"가 바닥에도
 * 그대로 남아 있었다. 두 숫자의 관계는
 * `styles/__tests__/quick-capture-resize-budget.test.ts`가 고정한다.
 */
export const CAPTURE_DIALOG_MIN_HEIGHT = 192;

/**
 * Ceiling for the Quick Capture editor's height, in px.
 *
 * 목표 렌더 크기가 아니라 폭주 방지용 안전 상한이다 — 실제 렌더 상한은
 * `.quick-capture-editor`의 `max-height: calc(85vh - 260px)`가 정하고, 대부분의
 * 화면에서 그쪽이 먼저 걸린다(뷰포트 900px 창이면 505px). 이 숫자가 실제로
 * 구속하려면 뷰포트 높이가 대략 1717px를 넘어야 한다.
 */
export const CAPTURE_DIALOG_MAX_HEIGHT = 1200;

export interface JournalSettingsSlice {
  /** §324-g Quick Capture 다이얼로그 본문 편집기 높이(px) — 드래그로 조정한다. */
  captureDialogHeight: number;
  journalCustomThemes: JournalTheme[];
  journalDirectory: string;
  journalEnabled: boolean;
  journalFilenameFormat: string;
  journalMonthlyEnabled: boolean;
  journalMonthlyTemplate: string;
  journalShowStreak: boolean;
  journalStartupBehavior: JournalStartupBehavior;
  journalTemplatePath: string;
  journalThemeId: string;
  journalUseHierarchy: boolean;
  journalWeeklyEnabled: boolean;
  journalWeeklyTemplate: string;
  journalWeekStartDay: "monday" | "sunday";
  journalYearlyEnabled: boolean;
  journalYearlyTemplate: string;
  memoriesMode: MemoriesMode;
  /** px 단위. `clampCaptureDialogHeight`가 정하는 범위로 잘린다 — 숫자를 여기
   *  다시 적지 않는다(§323 리뷰 Minor 7: 그렇게 갈라진 두 규칙이 결함이었다). */
  setCaptureDialogHeight: (px: number) => void;
  setJournalCustomThemes: (themes: JournalTheme[]) => void;
  setJournalDirectory: (dir: string) => void;
  setJournalEnabled: (enabled: boolean) => void;
  setJournalFilenameFormat: (fmt: string) => void;
  setJournalMonthlyEnabled: (enabled: boolean) => void;
  setJournalMonthlyTemplate: (path: string) => void;
  setJournalShowStreak: (enabled: boolean) => void;
  setJournalStartupBehavior: (behavior: JournalStartupBehavior) => void;
  setJournalTemplatePath: (path: string) => void;
  setJournalThemeId: (id: string) => void;
  setJournalUseHierarchy: (enabled: boolean) => void;
  setJournalWeeklyEnabled: (enabled: boolean) => void;
  setJournalWeeklyTemplate: (path: string) => void;
  setJournalWeekStartDay: (day: "monday" | "sunday") => void;
  setJournalYearlyEnabled: (enabled: boolean) => void;
  setJournalYearlyTemplate: (path: string) => void;
  setMemoriesMode: (mode: MemoriesMode) => void;
}

type JournalStartupBehavior = "nothing" | "openJournal";
type MemoriesMode = "full" | "oneline";

/**
 * The ONE rule for what a capture-dialog height may be.
 *
 * §323 리뷰 Minor 7: 예전에는 규칙이 둘이었다 — `use-capture-resize.ts`가
 * 드래그 중 바닥만 자르고, 이 파일의 setter가 바닥과 천장을 잘랐다. 하나의 값에
 * 두 개의 부분 규칙이라, 둘의 바닥이 서로 어긋나도(그리고 실제로 어긋났다)
 * 아무 테스트도 실패하지 않았다 — 어느 한쪽을 지워도 다른 쪽이 결과를 덮어
 * 초록으로 남았기 때문이다. 이제 양쪽이 이 함수를 부른다.
 */
export function clampCaptureDialogHeight(px: number): number {
  return Math.max(
    CAPTURE_DIALOG_MIN_HEIGHT,
    Math.min(px, CAPTURE_DIALOG_MAX_HEIGHT),
  );
}

export const createJournalSettingsSlice: StateCreator<
  JournalSettingsSlice,
  [],
  [],
  JournalSettingsSlice
> = (set) => ({
  // §56 Journal / Daily Notes
  journalEnabled: false,
  journalDirectory: "",
  journalFilenameFormat: "YYYY-MM-DD.md",
  journalTemplatePath: "",
  journalStartupBehavior: "openJournal",
  journalUseHierarchy: true,
  journalWeeklyEnabled: false,
  journalMonthlyEnabled: false,
  journalYearlyEnabled: false,
  journalWeekStartDay: "monday" as const,
  journalWeeklyTemplate: "",
  journalMonthlyTemplate: "",
  journalYearlyTemplate: "",

  // §56g Stats
  journalShowStreak: true,

  // §56h Journal Theme
  journalThemeId: "classic-diary",
  journalCustomThemes: [],

  // §56b Memories Panel UI state
  memoriesMode: "oneline" as const,

  // §324-g Quick Capture 창 높이 — 드래그로 조정한 값을 기억한다. 기본값이 곧
  // 바닥이다: 캡처 상자는 기본 상태에서 이미 CSS가 보장하는 가장 작은 크기이고
  // (`.quick-capture-editor`의 `min-height: 12rem`), 드래그는 키우는 쪽으로만
  // 의미가 있다. 이 값이 바뀌기 전까지는 기존 사용자에게 보이는 동작이 그대로다.
  captureDialogHeight: CAPTURE_DIALOG_MIN_HEIGHT,

  // Setters
  setJournalEnabled: (journalEnabled) => set({ journalEnabled }),
  setJournalDirectory: (journalDirectory) => set({ journalDirectory }),
  setJournalFilenameFormat: (journalFilenameFormat) =>
    set({ journalFilenameFormat }),
  setJournalTemplatePath: (journalTemplatePath) => set({ journalTemplatePath }),
  setJournalStartupBehavior: (journalStartupBehavior) =>
    set({ journalStartupBehavior }),
  setJournalUseHierarchy: (journalUseHierarchy) => set({ journalUseHierarchy }),
  setJournalWeeklyEnabled: (journalWeeklyEnabled: boolean) =>
    set({ journalWeeklyEnabled }),
  setJournalMonthlyEnabled: (journalMonthlyEnabled: boolean) =>
    set({ journalMonthlyEnabled }),
  setJournalYearlyEnabled: (journalYearlyEnabled: boolean) =>
    set({ journalYearlyEnabled }),
  setJournalWeekStartDay: (journalWeekStartDay: "monday" | "sunday") =>
    set({ journalWeekStartDay }),
  setJournalWeeklyTemplate: (journalWeeklyTemplate) =>
    set({ journalWeeklyTemplate }),
  setJournalMonthlyTemplate: (journalMonthlyTemplate) =>
    set({ journalMonthlyTemplate }),
  setJournalYearlyTemplate: (journalYearlyTemplate) =>
    set({ journalYearlyTemplate }),
  setJournalShowStreak: (journalShowStreak) => set({ journalShowStreak }),
  setJournalThemeId: (journalThemeId) => set({ journalThemeId }),
  setJournalCustomThemes: (journalCustomThemes) => set({ journalCustomThemes }),
  setMemoriesMode: (memoriesMode) => set({ memoriesMode }),
  // 경계는 이 파일 위쪽의 `clampCaptureDialogHeight` 하나가 정한다 — 여기에
  // 숫자를 다시 쓰면 §323 리뷰 Minor 7이 지적한 "값 하나에 부분 규칙 둘"이
  // 그대로 돌아온다. 두 상수와 CSS의 관계는
  // src/styles/__tests__/quick-capture-resize-budget.test.ts가 고정한다.
  setCaptureDialogHeight: (px: number) =>
    set({ captureDialogHeight: clampCaptureDialogHeight(px) }),
});
