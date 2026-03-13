import type { StateCreator } from "zustand";

export interface EditorSettingsSlice {
  autoPairBrackets: boolean;
  codeBlockLineNumbers: boolean;
  codeBlockStyle: CodeBlockStyle;
  diagrams: boolean;
  editorMaxWidth: number;
  extensionSettings: Record<string, unknown>;
  fontFamily: string;
  fontSize: number;
  highlight: boolean;
  inlineMath: boolean;
  lineHeight: number;
  lineNumbers: boolean;
  setAutoPairBrackets: (enabled: boolean) => void;
  setCodeBlockLineNumbers: (enabled: boolean) => void;
  setCodeBlockStyle: (style: CodeBlockStyle) => void;
  setDiagrams: (enabled: boolean) => void;
  setEditorMaxWidth: (width: number) => void;
  setExtensionSetting: (key: string, value: unknown) => void;
  setFontFamily: (family: string) => void;
  setFontSize: (size: number) => void;
  setHighlight: (enabled: boolean) => void;
  setInlineMath: (enabled: boolean) => void;
  setLineHeight: (height: number) => void;
  setLineNumbers: (enabled: boolean) => void;
  setSmartPunctuation: (enabled: boolean) => void;
  setSpellCheck: (enabled: boolean) => void;
  setStrikethrough: (enabled: boolean) => void;
  setTabSize: (size: number) => void;
  setZoomLevel: (level: number) => void;
  smartPunctuation: boolean;
  spellCheck: boolean;
  strikethrough: boolean;
  tabSize: number;
  zoomLevel: number;
}

type CodeBlockStyle = "contrast" | "default" | "minimal" | "paper";

export const createEditorSettingsSlice: StateCreator<
  EditorSettingsSlice,
  [],
  [],
  EditorSettingsSlice
> = (set) => ({
  // Editor
  fontFamily: "Pretendard",
  fontSize: 16,
  lineHeight: 1.75,
  tabSize: 2,
  lineNumbers: false,
  autoPairBrackets: true,
  editorMaxWidth: 800,
  zoomLevel: 1,
  spellCheck: false,

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

  // Editor setters
  setFontFamily: (fontFamily) => set({ fontFamily }),
  setFontSize: (fontSize) => set({ fontSize }),
  setLineHeight: (lineHeight) => set({ lineHeight }),
  setTabSize: (tabSize) => set({ tabSize }),
  setLineNumbers: (lineNumbers) => set({ lineNumbers }),
  setAutoPairBrackets: (autoPairBrackets) => set({ autoPairBrackets }),
  setEditorMaxWidth: (editorMaxWidth) => set({ editorMaxWidth }),
  setZoomLevel: (zoomLevel) =>
    set({
      zoomLevel: Math.round(Math.max(0.5, Math.min(2, zoomLevel)) * 100) / 100,
    }),
  setSpellCheck: (spellCheck) => set({ spellCheck }),

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
      if (key === "codeBlockLineNumbers")
        patch.codeBlockLineNumbers = value as boolean;
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
      extensionSettings: {
        ...state.extensionSettings,
        codeBlockLineNumbers,
      },
    })),
  setCodeBlockStyle: (codeBlockStyle) =>
    set((state) => ({
      codeBlockStyle,
      extensionSettings: { ...state.extensionSettings, codeBlockStyle },
    })),
});
