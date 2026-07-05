import type { JournalTheme } from "../../utils/journal/journal-themes";
import type { StateCreator } from "zustand";

export interface JournalSettingsSlice {
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
});
