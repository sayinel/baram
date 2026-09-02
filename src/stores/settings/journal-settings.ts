import type { JournalTheme } from "../../utils/journal/journal-themes";
import type { StateCreator } from "zustand";

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
  /** px 단위. 창이 사라지지 않도록 120~1200 사이로 clamp된다. */
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

  // §324-g Quick Capture 창 높이 — 드래그로 조정한 값을 기억한다. 기본값은
  // quick-capture.css의 `.quick-capture-editor` min-height(12rem)와 같다 —
  // 이 값이 바뀌기 전까지는 기존 사용자에게 보이는 동작이 그대로다.
  captureDialogHeight: 192,

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
  // 120~1200px로 clamp — 하한은 창이 화면에서 실질적으로 사라지지 않게, 상한은
  // 실수로 드래그를 창 밖까지 끌고 갔을 때의 폭주를 막는다.
  setCaptureDialogHeight: (px: number) =>
    set({ captureDialogHeight: Math.max(120, Math.min(px, 1200)) }),
});
