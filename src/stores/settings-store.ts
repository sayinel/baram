// §3.5 사용자 설정 스토어
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { tauriStorage } from "./tauri-storage";

type Theme = "light" | "dark" | "system";
type OnLaunch = "newFile" | "restoreLastFolder" | "restoreLastFile";
type WikilinkFormat = "wikilink" | "markdown";
type CodeBlockStyle = "default" | "minimal" | "contrast" | "paper";

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

  // Appearance
  theme: Theme;

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

  // Extension settings (dynamic key-value)
  extensionSettings: Record<string, unknown>;
  setExtensionSetting: (key: string, value: unknown) => void;

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

  // Appearance setters
  setTheme: (theme: Theme) => void;

  // Files setters
  setWikilinkFormat: (format: WikilinkFormat) => void;
  setAutoUpdateLinks: (enabled: boolean) => void;

  // Markdown setters
  setInlineMath: (enabled: boolean) => void;
  setHighlight: (enabled: boolean) => void;
  setStrikethrough: (enabled: boolean) => void;
  setSmartPunctuation: (enabled: boolean) => void;

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

  // Appearance
  theme: "system",

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

  // Extension settings (dynamic key-value)
  extensionSettings: {},

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

  // Appearance setters
  setTheme: (theme) => set({ theme }),

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
    theme: state.theme,
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
  }),
  version: 1,
  migrate: (persisted: unknown, _version: number) => {
    const state = persisted as Record<string, unknown>;
    const ext = (state.extensionSettings ?? {}) as Record<string, unknown>;
    for (const key of ["codeBlockLineNumbers", "codeBlockStyle", "diagrams"]) {
      if (key in state && !(key in ext)) {
        ext[key] = state[key];
      }
    }
    state.extensionSettings = ext;
    return state;
  },
  // Fallback for unversioned → v1 upgrade (Zustand skips migrate when stored version is undefined)
  onRehydrateStorage: () => (state) => {
    if (!state) return;
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
  },
}));
