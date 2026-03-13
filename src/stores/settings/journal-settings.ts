import type { JournalTheme } from "../../utils/journal-themes";
import type { StateCreator } from "zustand";

export interface JournalSettingsSlice {
  journalAIAutoSuggest: boolean;
  journalAIReflectionEnabled: boolean;
  journalCustomThemes: JournalTheme[];
  journalDirectory: string;
  journalEnabled: boolean;
  journalEnergyEnabled: boolean;
  journalFilenameFormat: string;
  journalMonthlyEnabled: boolean;
  journalMonthlyTemplate: string;
  journalMoodEnabled: boolean;
  journalPromptCategory: string;
  journalPromptEnabled: boolean;
  journalPromptMode: "random" | "sequential";
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
  memoriesTab: MemoriesTab;
  setJournalAIAutoSuggest: (enabled: boolean) => void;
  setJournalAIReflectionEnabled: (enabled: boolean) => void;
  setJournalCustomThemes: (themes: JournalTheme[]) => void;
  setJournalDirectory: (dir: string) => void;
  setJournalEnabled: (enabled: boolean) => void;
  setJournalEnergyEnabled: (enabled: boolean) => void;
  setJournalFilenameFormat: (fmt: string) => void;
  setJournalMonthlyEnabled: (enabled: boolean) => void;
  setJournalMonthlyTemplate: (path: string) => void;
  setJournalMoodEnabled: (enabled: boolean) => void;
  setJournalPromptCategory: (category: string) => void;
  setJournalPromptEnabled: (enabled: boolean) => void;
  setJournalPromptMode: (mode: "random" | "sequential") => void;
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
  setMemoriesTab: (tab: MemoriesTab) => void;
}
type JournalStartupBehavior = "nothing" | "openJournal";
type MemoriesMode = "full" | "oneline";

type MemoriesTab = "journal" | "notes";

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

  // §56e Mood/Energy
  journalMoodEnabled: true,
  journalEnergyEnabled: true,

  // §56g Stats
  journalShowStreak: true,

  // §56h Journal Theme
  journalThemeId: "classic-diary",
  journalCustomThemes: [],

  // §56i Prompts
  journalPromptEnabled: true,
  journalPromptCategory: "",
  journalPromptMode: "random" as const,

  // §56j AI Reflection
  journalAIReflectionEnabled: true,
  journalAIAutoSuggest: false,

  // §56b Memories Panel UI state
  memoriesTab: "journal" as const,
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
  setJournalMoodEnabled: (journalMoodEnabled) => set({ journalMoodEnabled }),
  setJournalEnergyEnabled: (journalEnergyEnabled) =>
    set({ journalEnergyEnabled }),
  setJournalShowStreak: (journalShowStreak) => set({ journalShowStreak }),
  setJournalThemeId: (journalThemeId) => set({ journalThemeId }),
  setJournalCustomThemes: (journalCustomThemes) => set({ journalCustomThemes }),
  setJournalPromptEnabled: (journalPromptEnabled) =>
    set({ journalPromptEnabled }),
  setJournalPromptCategory: (journalPromptCategory) =>
    set({ journalPromptCategory }),
  setJournalPromptMode: (journalPromptMode) => set({ journalPromptMode }),
  setJournalAIReflectionEnabled: (journalAIReflectionEnabled) =>
    set({ journalAIReflectionEnabled }),
  setJournalAIAutoSuggest: (journalAIAutoSuggest) =>
    set({ journalAIAutoSuggest }),
  setMemoriesTab: (memoriesTab) => set({ memoriesTab }),
  setMemoriesMode: (memoriesMode) => set({ memoriesMode }),
});
