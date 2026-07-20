// §3.5 사용자 설정 스토어
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { findThemeById, migrateThemeColors } from "../../types/theme";
import { tauriStorage } from "../system/tauri-storage";
import {
  type ActivityBarItemConfig,
  DEFAULT_ACTIVITY_BAR_CONFIG,
} from "./activity-bar-config";
import {
  type AppearanceSettingsSlice,
  createAppearanceSettingsSlice,
} from "./appearance-settings";
import {
  createEditorSettingsSlice,
  type EditorSettingsSlice,
} from "./editor-settings";
import {
  createGeneralSettingsSlice,
  type GeneralSettingsSlice,
} from "./general-settings";
import {
  createJournalSettingsSlice,
  type JournalSettingsSlice,
} from "./journal-settings";
import {
  createZettelkastenSettingsSlice,
  type ZettelkastenSettingsSlice,
} from "./zettelkasten-settings";
export type { ActivityBarItemConfig };
export { DEFAULT_ACTIVITY_BAR_CONFIG };

export type SettingsState = AppearanceSettingsSlice &
  EditorSettingsSlice &
  GeneralSettingsSlice &
  JournalSettingsSlice &
  ZettelkastenSettingsSlice;

export const useSettingsStore = create<SettingsState>()(
  persist(
    (...a) => ({
      ...createJournalSettingsSlice(...a),
      ...createZettelkastenSettingsSlice(...a),
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
        virtualizeLargeDocs: state.virtualizeLargeDocs,
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
        journalShowStreak: state.journalShowStreak,
        journalThemeId: state.journalThemeId,
        journalCustomThemes: state.journalCustomThemes,
        memoriesMode: state.memoriesMode,
        zettelkastenEnabled: state.zettelkastenEnabled,
        zettelkastenDirectory: state.zettelkastenDirectory,
        zettelkastenStartupBehavior: state.zettelkastenStartupBehavior,
        zettelkastenHomeNote: state.zettelkastenHomeNote,
        pandocPath: state.pandocPath,
        wordTemplatePath: state.wordTemplatePath,
        customExports: state.customExports,
        tagColors: state.tagColors,
        snapshotInterval: state.snapshotInterval,
        snapshotMaxCount: state.snapshotMaxCount,
        activityBarConfig: state.activityBarConfig,
        locale: state.locale,
        keybindingOverrides: state.keybindingOverrides,
        autoCheckUpdates: state.autoCheckUpdates,
      }),
      version: 16,
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

        // v9 → v10: Design token CSS variable rename — migrate custom theme color keys
        if (version < 10) {
          const themes = state.customThemes as Array<{
            [k: string]: unknown;
            colors: Record<string, string>;
          }>;
          if (Array.isArray(themes)) {
            state.customThemes = themes.map((theme) => ({
              ...theme,
              colors: migrateThemeColors(theme.colors),
            }));
          }
        }

        // v10 → v11: ThemeColors contract expansion (16 → 25 keys)
        if (version < 11) {
          const themes = state.customThemes as Array<{
            [k: string]: unknown;
            colors: Record<string, string>;
          }>;
          if (Array.isArray(themes)) {
            state.customThemes = themes.map((theme) => ({
              ...theme,
              colors: migrateThemeColors(theme.colors),
            }));
          }
        }

        // v11 → v12: §perf-large-file C4 windowing kill-switch (default on)
        if (version < 12) {
          if (state.virtualizeLargeDocs === undefined)
            state.virtualizeLargeDocs = true;
        }

        // v12 → v13: §P1 journal slim-down — drop removed setting keys
        // (Mood tracking, AI reflection cluster, daily-prompt, and the
        // Memories panel Journal/Notes tab now that Notes moves to a
        // separate Zettelkasten space).
        // Data-preserving: only clears stale settings; journal files untouched.
        if (version < 13) {
          delete state.journalMoodEnabled;
          delete state.journalAIReflectionEnabled;
          delete state.journalPromptEnabled;
          delete state.journalPromptCategory;
          delete state.journalPromptMode;
          delete state.memoriesTab;
        }

        // v13 → v14: Zettelkasten space settings (§92). Additive; disabled by default.
        if (version < 14) {
          if (state.zettelkastenEnabled === undefined)
            state.zettelkastenEnabled = false;
          if (state.zettelkastenDirectory === undefined)
            state.zettelkastenDirectory = "";
          if (state.zettelkastenStartupBehavior === undefined)
            state.zettelkastenStartupBehavior = "openInbox";
          if (state.zettelkastenHomeNote === undefined)
            state.zettelkastenHomeNote = "";
        }

        // v14 → v15: §100 add the Zettel hub activity-bar item
        // (append-if-missing, preserving user customizations/order)
        if (version < 15) {
          const cfg = state.activityBarConfig as
            undefined | { id: string; section: string; visible: boolean }[];
          if (Array.isArray(cfg) && !cfg.some((c) => c.id === "zettel")) {
            const item = { id: "zettel", visible: true, section: "top" };
            const idx = cfg.findIndex((c) => c.id === "tags");
            if (idx >= 0) cfg.splice(idx + 1, 0, item);
            else cfg.push(item);
          }
        }

        // v15 → v16: §206 App auto-update — periodic check toggle (default on)
        if (version < 16) {
          if (state.autoCheckUpdates === undefined) {
            state.autoCheckUpdates = true;
          }
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
