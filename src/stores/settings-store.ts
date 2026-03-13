// §3.5 사용자 설정 스토어
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { findThemeById } from "../types/theme";
import {
  type AppearanceSettingsSlice,
  createAppearanceSettingsSlice,
} from "./settings/appearance-settings";
import {
  createEditorSettingsSlice,
  type EditorSettingsSlice,
} from "./settings/editor-settings";
import {
  createGeneralSettingsSlice,
  type GeneralSettingsSlice,
} from "./settings/general-settings";
import {
  createJournalSettingsSlice,
  type JournalSettingsSlice,
} from "./settings/journal-settings";
import { tauriStorage } from "./tauri-storage";

export interface ActivityBarItemConfig {
  id: string;
  section: "bottom" | "top";
  visible: boolean;
}

export const DEFAULT_ACTIVITY_BAR_CONFIG: ActivityBarItemConfig[] = [
  // Top section — sidebar panels
  { id: "files", visible: true, section: "top" },
  { id: "search", visible: true, section: "top" },
  { id: "outline", visible: true, section: "top" },
  { id: "backlinks", visible: true, section: "top" },
  { id: "bookmarks", visible: true, section: "top" },
  { id: "graph", visible: true, section: "top" },
  { id: "git", visible: true, section: "top" },
  { id: "calendar", visible: true, section: "top" },
  { id: "tags", visible: true, section: "top" },
  { id: "skills-gallery", visible: true, section: "top" },
  { id: "plugins", visible: true, section: "top" },
  // Bottom section — right panels + utilities
  { id: "chat", visible: true, section: "bottom" },
  { id: "memories", visible: true, section: "bottom" },
  { id: "photo-gallery", visible: true, section: "bottom" },
  { id: "snapshots", visible: true, section: "bottom" },
  { id: "help", visible: true, section: "bottom" },
];

export type SettingsState = AppearanceSettingsSlice &
  EditorSettingsSlice &
  GeneralSettingsSlice &
  JournalSettingsSlice;

export const useSettingsStore = create<SettingsState>()(
  persist(
    (...a) => ({
      ...createJournalSettingsSlice(...a),
      ...createEditorSettingsSlice(...a),
      ...createAppearanceSettingsSlice(...a),
      ...createGeneralSettingsSlice(...a),
      // Override defaults that need the constant from this module
      activityBarConfig: DEFAULT_ACTIVITY_BAR_CONFIG,
      resetActivityBarConfig: () =>
        a[0]({ activityBarConfig: DEFAULT_ACTIVITY_BAR_CONFIG }),
    }),
    {
      name: "baram:settings",
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) => ({
        onLaunch: state.onLaunch,
        autoSave: state.autoSave,
        autoSaveDelay: state.autoSaveDelay,
        spellCheck: state.spellCheck,
        showWelcome: state.showWelcome,
        recentFolders: state.recentFolders,
        recentFiles: state.recentFiles,
        lastOpenedFolder: state.lastOpenedFolder,
        lastOpenedFile: state.lastOpenedFile,
        fontFamily: state.fontFamily,
        fontSize: state.fontSize,
        lineHeight: state.lineHeight,
        tabSize: state.tabSize,
        lineNumbers: state.lineNumbers,
        autoPairBrackets: state.autoPairBrackets,
        editorMaxWidth: state.editorMaxWidth,
        zoomLevel: state.zoomLevel,
        theme: state.theme,
        activeThemeId: state.activeThemeId,
        customThemes: state.customThemes,
        wikilinkFormat: state.wikilinkFormat,
        autoUpdateLinks: state.autoUpdateLinks,
        inlineMath: state.inlineMath,
        highlight: state.highlight,
        strikethrough: state.strikethrough,
        diagrams: state.diagrams,
        codeBlockLineNumbers: state.codeBlockLineNumbers,
        codeBlockStyle: state.codeBlockStyle,
        smartPunctuation: state.smartPunctuation,
        extensionSettings: state.extensionSettings,
        journalEnabled: state.journalEnabled,
        journalDirectory: state.journalDirectory,
        journalFilenameFormat: state.journalFilenameFormat,
        journalTemplatePath: state.journalTemplatePath,
        journalStartupBehavior: state.journalStartupBehavior,
        journalUseHierarchy: state.journalUseHierarchy,
        journalWeeklyEnabled: state.journalWeeklyEnabled,
        journalMonthlyEnabled: state.journalMonthlyEnabled,
        journalYearlyEnabled: state.journalYearlyEnabled,
        journalWeekStartDay: state.journalWeekStartDay,
        journalWeeklyTemplate: state.journalWeeklyTemplate,
        journalMonthlyTemplate: state.journalMonthlyTemplate,
        journalYearlyTemplate: state.journalYearlyTemplate,
        journalMoodEnabled: state.journalMoodEnabled,
        journalEnergyEnabled: state.journalEnergyEnabled,
        journalShowStreak: state.journalShowStreak,
        journalThemeId: state.journalThemeId,
        journalCustomThemes: state.journalCustomThemes,
        journalPromptEnabled: state.journalPromptEnabled,
        journalPromptCategory: state.journalPromptCategory,
        journalPromptMode: state.journalPromptMode,
        journalAIReflectionEnabled: state.journalAIReflectionEnabled,
        journalAIAutoSuggest: state.journalAIAutoSuggest,
        memoriesTab: state.memoriesTab,
        memoriesMode: state.memoriesMode,
        pandocPath: state.pandocPath,
        wordTemplatePath: state.wordTemplatePath,
        customExports: state.customExports,
        tagColors: state.tagColors,
        snapshotInterval: state.snapshotInterval,
        snapshotMaxCount: state.snapshotMaxCount,
        activityBarConfig: state.activityBarConfig,
        locale: state.locale,
        keybindingOverrides: state.keybindingOverrides,
      }),
      version: 9,
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as Record<string, unknown>;

        // v0/v1 → v2: extensionSettings migration (from v1)
        if (version < 1) {
          const ext = (state.extensionSettings ?? {}) as Record<
            string,
            unknown
          >;
          for (const key of [
            "codeBlockLineNumbers",
            "codeBlockStyle",
            "diagrams",
          ]) {
            if (key in state && !(key in ext)) {
              ext[key] = state[key];
            }
          }
          state.extensionSettings = ext;
        }

        // v0/v1/v2 → v3: §55 Pandoc export settings
        if (version < 3) {
          if (!state.pandocPath) state.pandocPath = "pandoc";
          if (!state.wordTemplatePath) state.wordTemplatePath = "";
          if (!state.customExports) state.customExports = [];
        }

        // v3 → v4: §56 Journal settings
        if (version < 4) {
          if (state.journalEnabled === undefined) state.journalEnabled = false;
          // Clear old relative paths — only absolute paths are valid now
          const jd = state.journalDirectory as string | undefined;
          if (jd && !jd.startsWith("/") && !/^[A-Z]:\\/.test(jd)) {
            state.journalDirectory = "";
          }
          if (!state.journalFilenameFormat)
            state.journalFilenameFormat = "YYYY-MM-DD.md";
          if (state.journalTemplatePath === undefined)
            state.journalTemplatePath = "";
          if (!state.journalStartupBehavior)
            state.journalStartupBehavior = "openJournal";
        }

        // v4 → v5: §56a Journal hierarchical folder structure
        if (version < 5) {
          if (state.journalUseHierarchy === undefined)
            state.journalUseHierarchy = true;
        }

        // v5 → v6: §56f Periodic notes settings
        if (version < 6) {
          if (state.journalWeeklyEnabled === undefined)
            state.journalWeeklyEnabled = false;
          if (state.journalMonthlyEnabled === undefined)
            state.journalMonthlyEnabled = false;
          if (state.journalYearlyEnabled === undefined)
            state.journalYearlyEnabled = false;
          if (state.journalWeekStartDay === undefined)
            state.journalWeekStartDay = "monday";
        }

        // v6 → v7: §14.3 optional journal settings + §56h theme ID migration
        if (version < 7) {
          if (state.journalMoodEnabled === undefined)
            state.journalMoodEnabled = true;
          if (state.journalEnergyEnabled === undefined)
            state.journalEnergyEnabled = true;
          if (state.journalShowStreak === undefined)
            state.journalShowStreak = true;
          if (state.journalCustomThemes === undefined)
            state.journalCustomThemes = [];
          if (state.journalPromptEnabled === undefined)
            state.journalPromptEnabled = true;
          if (state.journalPromptCategory === undefined)
            state.journalPromptCategory = "";
          if (state.journalPromptMode === undefined)
            state.journalPromptMode = "random";
          if (state.journalAIReflectionEnabled === undefined)
            state.journalAIReflectionEnabled = true;
          if (state.journalAIAutoSuggest === undefined)
            state.journalAIAutoSuggest = false;
          // Migrate old theme IDs to spec names
          const themeMap: Record<string, string> = {
            default: "classic-diary",
            nature: "moleskine",
            ocean: "muji",
            sunset: "night-owl",
            minimal: "vintage",
          };
          const oldId = state.journalThemeId as string | undefined;
          if (oldId && themeMap[oldId]) state.journalThemeId = themeMap[oldId];
        }

        // v0/v1 → v2: theme migration
        if (version < 2) {
          const oldTheme = state.theme as string | undefined;
          if (!state.activeThemeId) {
            if (oldTheme === "light") state.activeThemeId = "default-light";
            else if (oldTheme === "dark") state.activeThemeId = "default-dark";
            else state.activeThemeId = "system";
          }
          if (!state.customThemes) state.customThemes = [];
        }

        // v7 → v8: Keybinding overrides
        if (version < 8) {
          if (!state.keybindingOverrides) state.keybindingOverrides = {};
        }

        // v8 → v9: Home screen recent lists + last-opened paths
        if (version < 9) {
          if (!state.recentFolders) state.recentFolders = [];
          if (!state.recentFiles) state.recentFiles = [];
          if (state.lastOpenedFolder === undefined)
            state.lastOpenedFolder = null;
          if (state.lastOpenedFile === undefined) state.lastOpenedFile = null;
        }

        return state;
      },
      // Fallback for unversioned → v1 upgrade (Zustand skips migrate when stored version is undefined)
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // extensionSettings sync (existing)
        const ext = { ...state.extensionSettings };
        let dirty = false;
        for (const key of [
          "codeBlockLineNumbers",
          "codeBlockStyle",
          "diagrams",
        ] as const) {
          if (key in state && !(key in ext)) {
            ext[key] = state[key];
            dirty = true;
          }
        }
        if (dirty) {
          useSettingsStore.setState({ extensionSettings: ext });
        }
        // Theme sync: ensure theme field matches activeThemeId
        if (state.activeThemeId && state.activeThemeId !== "system") {
          const t = findThemeById(state.activeThemeId, state.customThemes);
          if (t && state.theme !== t.base) {
            useSettingsStore.setState({ theme: t.base });
          }
        }
      },
    },
  ),
);
