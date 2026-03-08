// §3.5 사용자 설정 스토어
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { tauriStorage } from "./tauri-storage";
import { findThemeById } from "../types/theme";
import type { ThemeDef } from "../types/theme";
import type { CustomExportItem } from "../ipc/types";
import type { JournalTheme } from "../utils/journal-themes";

type Theme = "light" | "dark" | "system";
type OnLaunch = "newFile" | "restoreLastFolder" | "restoreLastFile";
type WikilinkFormat = "wikilink" | "markdown";
type CodeBlockStyle = "default" | "minimal" | "contrast" | "paper";
type JournalStartupBehavior = "openJournal" | "nothing";
type MemoriesTab = "journal" | "notes";
type MemoriesMode = "oneline" | "full";

export interface ActivityBarItemConfig {
  id: string;
  visible: boolean;
  section: "top" | "bottom";
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
  // Bottom section — right panels + utilities
  { id: "chat", visible: true, section: "bottom" },
  { id: "memories", visible: true, section: "bottom" },
  { id: "photo-gallery", visible: true, section: "bottom" },
  { id: "snapshots", visible: true, section: "bottom" },
  { id: "help", visible: true, section: "bottom" },
];

interface SettingsState {
  // General
  onLaunch: OnLaunch;
  autoSave: boolean;
  autoSaveDelay: number; // ms
  spellCheck: boolean;
  showWelcome: boolean;

  // Editor
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  tabSize: number;
  lineNumbers: boolean;
  autoPairBrackets: boolean;
  editorMaxWidth: number; // px, 0 = no limit
  zoomLevel: number; // 0.5 ~ 2.0 (1.0 = 100%)

  // Appearance
  theme: Theme;
  activeThemeId: string;      // "system" | "default-light" | "default-dark" | custom id
  customThemes: ThemeDef[];

  // Files & Links
  wikilinkFormat: WikilinkFormat;
  autoUpdateLinks: boolean;

  // Markdown
  inlineMath: boolean;
  highlight: boolean;
  strikethrough: boolean;
  diagrams: boolean;
  codeBlockLineNumbers: boolean;
  codeBlockStyle: CodeBlockStyle;
  smartPunctuation: boolean;

  // §56 Journal / Daily Notes
  journalEnabled: boolean;
  journalDirectory: string;
  journalFilenameFormat: string;
  journalTemplatePath: string;
  journalStartupBehavior: JournalStartupBehavior;
  journalUseHierarchy: boolean;  // §56a: daily/YYYY/MM/ 구조 사용 여부
  journalWeeklyEnabled: boolean;  // §56f: weekly notes
  journalMonthlyEnabled: boolean;  // §56f: monthly notes
  journalYearlyEnabled: boolean;  // §56f: yearly notes
  journalWeekStartDay: "monday" | "sunday";  // §56f: week start day
  journalWeeklyTemplate: string;    // §56a: weekly note template path
  journalMonthlyTemplate: string;   // §56a: monthly note template path
  journalYearlyTemplate: string;    // §56a: yearly note template path

  // §56e Mood/Energy
  journalMoodEnabled: boolean;
  journalEnergyEnabled: boolean;

  // §56g Stats
  journalShowStreak: boolean;

  // §56h Journal Theme
  journalThemeId: string;
  journalCustomThemes: JournalTheme[];

  // §56i Prompts
  journalPromptEnabled: boolean;
  journalPromptCategory: string;     // "" = all categories
  journalPromptMode: "random" | "sequential";

  // §56j AI Reflection
  journalAIReflectionEnabled: boolean;
  journalAIAutoSuggest: boolean;     // auto-suggest after save

  // §56b Memories Panel UI state
  memoriesTab: MemoriesTab;
  memoriesMode: MemoriesMode;

  // §55 Pandoc Extended Export
  pandocPath: string;
  wordTemplatePath: string;
  customExports: CustomExportItem[];
  setPandocPath: (path: string) => void;
  setWordTemplatePath: (path: string) => void;
  setCustomExports: (items: CustomExportItem[]) => void;

  // Snapshots (§71)
  snapshotInterval: number;  // minutes, 0 = disabled
  snapshotMaxCount: number;
  setSnapshotInterval: (minutes: number) => void;
  setSnapshotMaxCount: (count: number) => void;

  // Extension settings (dynamic key-value)
  extensionSettings: Record<string, unknown>;
  setExtensionSetting: (key: string, value: unknown) => void;

  // Activity Bar config
  activityBarConfig: ActivityBarItemConfig[];
  setActivityBarConfig: (config: ActivityBarItemConfig[]) => void;
  resetActivityBarConfig: () => void;

  // i18n
  locale: string;
  setLocale: (locale: string) => void;

  // Tag colors
  tagColors: Record<string, string>;
  setTagColor: (tag: string, color: string) => void;
  removeTagColor: (tag: string) => void;

  // Keybinding overrides
  keybindingOverrides: Record<string, string>;
  setKeybindingOverride: (id: string, key: string) => void;
  removeKeybindingOverride: (id: string) => void;
  resetAllKeybindings: () => void;

  // General setters
  setOnLaunch: (onLaunch: OnLaunch) => void;
  setAutoSave: (enabled: boolean) => void;
  setAutoSaveDelay: (delay: number) => void;
  setSpellCheck: (enabled: boolean) => void;
  setShowWelcome: (show: boolean) => void;

  // Editor setters
  setFontFamily: (family: string) => void;
  setFontSize: (size: number) => void;
  setLineHeight: (height: number) => void;
  setTabSize: (size: number) => void;
  setLineNumbers: (enabled: boolean) => void;
  setAutoPairBrackets: (enabled: boolean) => void;
  setEditorMaxWidth: (width: number) => void;
  setZoomLevel: (level: number) => void;

  // Appearance setters
  setTheme: (theme: Theme) => void;
  setActiveTheme: (id: string) => void;
  saveCustomTheme: (theme: ThemeDef) => void;
  deleteCustomTheme: (id: string) => void;

  // Files setters
  setWikilinkFormat: (format: WikilinkFormat) => void;
  setAutoUpdateLinks: (enabled: boolean) => void;

  // Markdown setters
  setInlineMath: (enabled: boolean) => void;
  setHighlight: (enabled: boolean) => void;
  setStrikethrough: (enabled: boolean) => void;
  setSmartPunctuation: (enabled: boolean) => void;

  // §56 Journal setters
  setJournalEnabled: (enabled: boolean) => void;
  setJournalDirectory: (dir: string) => void;
  setJournalFilenameFormat: (fmt: string) => void;
  setJournalTemplatePath: (path: string) => void;
  setJournalStartupBehavior: (behavior: JournalStartupBehavior) => void;
  setJournalUseHierarchy: (enabled: boolean) => void;

  // §56a Periodic template setters
  setJournalWeeklyTemplate: (path: string) => void;
  setJournalMonthlyTemplate: (path: string) => void;
  setJournalYearlyTemplate: (path: string) => void;

  // §56e Mood/Energy setters
  setJournalMoodEnabled: (enabled: boolean) => void;
  setJournalEnergyEnabled: (enabled: boolean) => void;

  // §56g Stats setter
  setJournalShowStreak: (enabled: boolean) => void;

  // §56h Journal Theme setters
  setJournalThemeId: (id: string) => void;
  setJournalCustomThemes: (themes: JournalTheme[]) => void;

  // §56i Prompt setters
  setJournalPromptEnabled: (enabled: boolean) => void;
  setJournalPromptCategory: (category: string) => void;
  setJournalPromptMode: (mode: "random" | "sequential") => void;

  // §56j AI Reflection setters
  setJournalAIReflectionEnabled: (enabled: boolean) => void;
  setJournalAIAutoSuggest: (enabled: boolean) => void;

  // §56b Memories Panel UI state setters
  setMemoriesTab: (tab: MemoriesTab) => void;
  setMemoriesMode: (mode: MemoriesMode) => void;

  // Legacy setters (delegate to setExtensionSetting — will be removed after SettingsModal migration)
  setDiagrams: (enabled: boolean) => void;
  setCodeBlockLineNumbers: (enabled: boolean) => void;
  setCodeBlockStyle: (style: CodeBlockStyle) => void;
}

export const useSettingsStore = create<SettingsState>()(persist((set) => ({
  // General
  onLaunch: "restoreLastFolder",
  autoSave: true,
  autoSaveDelay: 2000,
  spellCheck: false,
  showWelcome: true,

  // Editor
  fontFamily: "Pretendard",
  fontSize: 16,
  lineHeight: 1.75,
  tabSize: 2,
  lineNumbers: false,
  autoPairBrackets: true,
  editorMaxWidth: 800,
  zoomLevel: 1,

  // Appearance
  theme: "system",
  activeThemeId: "system",
  customThemes: [],

  // Files & Links
  wikilinkFormat: "wikilink",
  autoUpdateLinks: true,

  // Markdown
  inlineMath: true,
  highlight: true,
  strikethrough: true,
  diagrams: true,
  codeBlockLineNumbers: false,
  codeBlockStyle: "default",
  smartPunctuation: false,

  // §56 Journal / Daily Notes
  journalEnabled: false,
  journalDirectory: "",
  journalFilenameFormat: "YYYY-MM-DD.md",
  journalTemplatePath: "",
  journalStartupBehavior: "openJournal",
  journalUseHierarchy: true,  // §56a: default to hierarchical
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

  // §55 Pandoc Extended Export
  pandocPath: "pandoc",
  wordTemplatePath: "",
  customExports: [],
  setPandocPath: (pandocPath) => set({ pandocPath }),
  setWordTemplatePath: (wordTemplatePath) => set({ wordTemplatePath }),
  setCustomExports: (customExports) => set({ customExports }),

  // Snapshots (§71)
  snapshotInterval: 30,
  snapshotMaxCount: 50,
  setSnapshotInterval: (snapshotInterval) => set({ snapshotInterval }),
  setSnapshotMaxCount: (snapshotMaxCount) => set({ snapshotMaxCount }),

  // Extension settings (dynamic key-value)
  extensionSettings: {},

  // Activity Bar config
  activityBarConfig: DEFAULT_ACTIVITY_BAR_CONFIG,
  setActivityBarConfig: (activityBarConfig) => set({ activityBarConfig }),
  resetActivityBarConfig: () => set({ activityBarConfig: DEFAULT_ACTIVITY_BAR_CONFIG }),

  // i18n
  locale: "en",
  setLocale: (locale) => set({ locale }),

  // Tag colors
  tagColors: {},
  setTagColor: (tag, color) => set((state) => ({
    tagColors: { ...state.tagColors, [tag]: color },
  })),
  removeTagColor: (tag) => set((state) => {
    const { [tag]: _, ...rest } = state.tagColors;
    return { tagColors: rest };
  }),

  // Keybinding overrides
  keybindingOverrides: {},
  setKeybindingOverride: (id, key) =>
    set((s) => ({ keybindingOverrides: { ...s.keybindingOverrides, [id]: key } })),
  removeKeybindingOverride: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.keybindingOverrides;
      return { keybindingOverrides: rest };
    }),
  resetAllKeybindings: () => set({ keybindingOverrides: {} }),

  // General setters
  setOnLaunch: (onLaunch) => set({ onLaunch }),
  setAutoSave: (autoSave) => set({ autoSave }),
  setAutoSaveDelay: (autoSaveDelay) => set({ autoSaveDelay }),
  setSpellCheck: (spellCheck) => set({ spellCheck }),
  setShowWelcome: (showWelcome) => set({ showWelcome }),

  // Editor setters
  setFontFamily: (fontFamily) => set({ fontFamily }),
  setFontSize: (fontSize) => set({ fontSize }),
  setLineHeight: (lineHeight) => set({ lineHeight }),
  setTabSize: (tabSize) => set({ tabSize }),
  setLineNumbers: (lineNumbers) => set({ lineNumbers }),
  setAutoPairBrackets: (autoPairBrackets) => set({ autoPairBrackets }),
  setEditorMaxWidth: (editorMaxWidth) => set({ editorMaxWidth }),
  setZoomLevel: (zoomLevel) => set({ zoomLevel: Math.round(Math.max(0.5, Math.min(2, zoomLevel)) * 100) / 100 }),

  // Appearance setters
  setTheme: (theme) => {
    const id = theme === "light" ? "default-light" : theme === "dark" ? "default-dark" : "system";
    useSettingsStore.getState().setActiveTheme(id);
  },
  setActiveTheme: (id) =>
    set((state) => {
      let base: "light" | "dark" | "system" = "system";
      if (id !== "system") {
        const theme = findThemeById(id, state.customThemes);
        base = theme?.base ?? "light";
      }
      return { activeThemeId: id, theme: base };
    }),
  saveCustomTheme: (theme) =>
    set((state) => {
      const idx = state.customThemes.findIndex((t) => t.id === theme.id);
      const updated = [...state.customThemes];
      if (idx >= 0) updated[idx] = theme;
      else updated.push(theme);
      return { customThemes: updated };
    }),
  deleteCustomTheme: (id) =>
    set((state) => ({
      customThemes: state.customThemes.filter((t) => t.id !== id),
      activeThemeId: state.activeThemeId === id ? "system" : state.activeThemeId,
      theme: state.activeThemeId === id ? "system" : state.theme,
    })),

  // Files setters
  setWikilinkFormat: (wikilinkFormat) => set({ wikilinkFormat }),
  setAutoUpdateLinks: (autoUpdateLinks) => set({ autoUpdateLinks }),

  // Markdown setters
  setInlineMath: (inlineMath) => set({ inlineMath }),
  setHighlight: (highlight) => set({ highlight }),
  setStrikethrough: (strikethrough) => set({ strikethrough }),
  setSmartPunctuation: (smartPunctuation) => set({ smartPunctuation }),

  // Extension settings setter (with backward-compat sync)
  setExtensionSetting: (key, value) =>
    set((state) => {
      const newExt = { ...state.extensionSettings, [key]: value };
      const patch: Record<string, unknown> = { extensionSettings: newExt };
      // Backward compat: sync legacy fields
      if (key === "codeBlockLineNumbers") patch.codeBlockLineNumbers = value as boolean;
      if (key === "codeBlockStyle") patch.codeBlockStyle = value as string;
      if (key === "diagrams") patch.diagrams = value as boolean;
      return patch;
    }),

  // §56 Journal setters
  setJournalEnabled: (journalEnabled) => set({ journalEnabled }),
  setJournalDirectory: (journalDirectory) => set({ journalDirectory }),
  setJournalFilenameFormat: (journalFilenameFormat) => set({ journalFilenameFormat }),
  setJournalTemplatePath: (journalTemplatePath) => set({ journalTemplatePath }),
  setJournalStartupBehavior: (journalStartupBehavior) => set({ journalStartupBehavior }),
  setJournalUseHierarchy: (journalUseHierarchy) => set({ journalUseHierarchy }),
  setJournalWeeklyEnabled: (journalWeeklyEnabled: boolean) => set({ journalWeeklyEnabled }),
  setJournalMonthlyEnabled: (journalMonthlyEnabled: boolean) => set({ journalMonthlyEnabled }),
  setJournalYearlyEnabled: (journalYearlyEnabled: boolean) => set({ journalYearlyEnabled }),
  setJournalWeekStartDay: (journalWeekStartDay: "monday" | "sunday") => set({ journalWeekStartDay }),
  setJournalWeeklyTemplate: (journalWeeklyTemplate) => set({ journalWeeklyTemplate }),
  setJournalMonthlyTemplate: (journalMonthlyTemplate) => set({ journalMonthlyTemplate }),
  setJournalYearlyTemplate: (journalYearlyTemplate) => set({ journalYearlyTemplate }),

  // §56e Mood/Energy setters
  setJournalMoodEnabled: (journalMoodEnabled) => set({ journalMoodEnabled }),
  setJournalEnergyEnabled: (journalEnergyEnabled) => set({ journalEnergyEnabled }),

  // §56g Stats setter
  setJournalShowStreak: (journalShowStreak) => set({ journalShowStreak }),

  // §56h Journal Theme setters
  setJournalThemeId: (journalThemeId) => set({ journalThemeId }),
  setJournalCustomThemes: (journalCustomThemes) => set({ journalCustomThemes }),

  // §56i Prompt setters
  setJournalPromptEnabled: (journalPromptEnabled) => set({ journalPromptEnabled }),
  setJournalPromptCategory: (journalPromptCategory) => set({ journalPromptCategory }),
  setJournalPromptMode: (journalPromptMode) => set({ journalPromptMode }),

  // §56j AI Reflection setters
  setJournalAIReflectionEnabled: (journalAIReflectionEnabled) => set({ journalAIReflectionEnabled }),
  setJournalAIAutoSuggest: (journalAIAutoSuggest) => set({ journalAIAutoSuggest }),

  // §56b Memories Panel UI state setters
  setMemoriesTab: (memoriesTab) => set({ memoriesTab }),
  setMemoriesMode: (memoriesMode) => set({ memoriesMode }),

  // Legacy setters — delegate to extensionSettings (remove after SettingsModal migration)
  setDiagrams: (diagrams) =>
    set((state) => ({
      diagrams,
      extensionSettings: { ...state.extensionSettings, diagrams },
    })),
  setCodeBlockLineNumbers: (codeBlockLineNumbers) =>
    set((state) => ({
      codeBlockLineNumbers,
      extensionSettings: { ...state.extensionSettings, codeBlockLineNumbers },
    })),
  setCodeBlockStyle: (codeBlockStyle) =>
    set((state) => ({
      codeBlockStyle,
      extensionSettings: { ...state.extensionSettings, codeBlockStyle },
    })),
}), {
  name: "baram:settings",
  storage: createJSONStorage(() => tauriStorage),
  partialize: (state) => ({
    onLaunch: state.onLaunch,
    autoSave: state.autoSave,
    autoSaveDelay: state.autoSaveDelay,
    spellCheck: state.spellCheck,
    showWelcome: state.showWelcome,
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
  version: 8,
  migrate: (persisted: unknown, version: number) => {
    const state = persisted as Record<string, unknown>;

    // v0/v1 → v2: extensionSettings migration (from v1)
    if (version < 1) {
      const ext = (state.extensionSettings ?? {}) as Record<string, unknown>;
      for (const key of ["codeBlockLineNumbers", "codeBlockStyle", "diagrams"]) {
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
      if (!state.journalFilenameFormat) state.journalFilenameFormat = "YYYY-MM-DD.md";
      if (state.journalTemplatePath === undefined) state.journalTemplatePath = "";
      if (!state.journalStartupBehavior) state.journalStartupBehavior = "openJournal";
    }

    // v4 → v5: §56a Journal hierarchical folder structure
    if (version < 5) {
      if (state.journalUseHierarchy === undefined) state.journalUseHierarchy = true;
    }

    // v5 → v6: §56f Periodic notes settings
    if (version < 6) {
      if (state.journalWeeklyEnabled === undefined) state.journalWeeklyEnabled = false;
      if (state.journalMonthlyEnabled === undefined) state.journalMonthlyEnabled = false;
      if (state.journalYearlyEnabled === undefined) state.journalYearlyEnabled = false;
      if (state.journalWeekStartDay === undefined) state.journalWeekStartDay = "monday";
    }

    // v6 → v7: §14.3 optional journal settings + §56h theme ID migration
    if (version < 7) {
      if (state.journalMoodEnabled === undefined) state.journalMoodEnabled = true;
      if (state.journalEnergyEnabled === undefined) state.journalEnergyEnabled = true;
      if (state.journalShowStreak === undefined) state.journalShowStreak = true;
      if (state.journalCustomThemes === undefined) state.journalCustomThemes = [];
      if (state.journalPromptEnabled === undefined) state.journalPromptEnabled = true;
      if (state.journalPromptCategory === undefined) state.journalPromptCategory = "";
      if (state.journalPromptMode === undefined) state.journalPromptMode = "random";
      if (state.journalAIReflectionEnabled === undefined) state.journalAIReflectionEnabled = true;
      if (state.journalAIAutoSuggest === undefined) state.journalAIAutoSuggest = false;
      // Migrate old theme IDs to spec names
      const themeMap: Record<string, string> = {
        default: "classic-diary", nature: "moleskine", ocean: "muji",
        sunset: "night-owl", minimal: "vintage",
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

    return state;
  },
  // Fallback for unversioned → v1 upgrade (Zustand skips migrate when stored version is undefined)
  onRehydrateStorage: () => (state) => {
    if (!state) return;
    // extensionSettings sync (existing)
    const ext = { ...state.extensionSettings };
    let dirty = false;
    for (const key of ["codeBlockLineNumbers", "codeBlockStyle", "diagrams"] as const) {
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
}));
