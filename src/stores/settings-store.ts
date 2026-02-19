// §3.5 사용자 설정 스토어
import { create } from "zustand";

type Theme = "light" | "dark" | "system";

interface SettingsState {
  theme: Theme;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize: number;
  autoSave: boolean;
  autoSaveDelay: number; // ms
  spellCheck: boolean;
  showWelcome: boolean;

  setTheme: (theme: Theme) => void;
  setFontSize: (size: number) => void;
  setFontFamily: (family: string) => void;
  setLineHeight: (height: number) => void;
  setTabSize: (size: number) => void;
  setAutoSave: (enabled: boolean) => void;
  setAutoSaveDelay: (delay: number) => void;
  setSpellCheck: (enabled: boolean) => void;
  setShowWelcome: (show: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: "system",
  fontSize: 16,
  fontFamily: "Pretendard",
  lineHeight: 1.75,
  tabSize: 2,
  autoSave: true,
  autoSaveDelay: 2000,
  spellCheck: false,
  showWelcome: localStorage.getItem("baram:onboarding-complete") !== "true",

  setTheme: (theme) => set({ theme }),
  setFontSize: (fontSize) => set({ fontSize }),
  setFontFamily: (fontFamily) => set({ fontFamily }),
  setLineHeight: (lineHeight) => set({ lineHeight }),
  setTabSize: (tabSize) => set({ tabSize }),
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
}));
