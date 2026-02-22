// §3.5 사용자 설정 스토어
import { create } from "zustand";

type Theme = "light" | "dark" | "system";
type OnLaunch = "newFile" | "restoreLastFolder" | "restoreLastFile";
type WikilinkFormat = "wikilink" | "markdown";
type CodeBlockStyle = "default" | "minimal" | "contrast";

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
  setDiagrams: (enabled: boolean) => void;
  setCodeBlockLineNumbers: (enabled: boolean) => void;
  setCodeBlockStyle: (style: CodeBlockStyle) => void;
  setSmartPunctuation: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  // General
  onLaunch: "restoreLastFolder",
  autoSave: true,
  autoSaveDelay: 2000,
  spellCheck: false,
  showWelcome: localStorage.getItem("baram:onboarding-complete") !== "true",

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

  // General setters
  setOnLaunch: (onLaunch) => set({ onLaunch }),
  setAutoSave: (autoSave) => set({ autoSave }),
  setAutoSaveDelay: (autoSaveDelay) => set({ autoSaveDelay }),
  setSpellCheck: (spellCheck) => set({ spellCheck }),
  setShowWelcome: (showWelcome) => {
    if (!showWelcome) {
      localStorage.setItem("baram:onboarding-complete", "true");
    } else {
      localStorage.removeItem("baram:onboarding-complete");
    }
    set({ showWelcome });
  },

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
  setDiagrams: (diagrams) => set({ diagrams }),
  setCodeBlockLineNumbers: (codeBlockLineNumbers) => set({ codeBlockLineNumbers }),
  setCodeBlockStyle: (codeBlockStyle) => set({ codeBlockStyle }),
  setSmartPunctuation: (smartPunctuation) => set({ smartPunctuation }),
}));
