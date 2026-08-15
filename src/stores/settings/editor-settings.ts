import type { StateCreator } from "zustand";

import { clampZoomLevel } from "../../utils/zoom";

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
  setVirtualizeLargeDocs: (enabled: boolean) => void;
  setZoomLevel: (level: number) => void;
  smartPunctuation: boolean;
  spellCheck: boolean;
  strikethrough: boolean;
  tabSize: number;
  // §perf-large-file C4: window large docs (display:none off-screen blocks).
  // Kill-switch — default on; active only on the large keep-alive editor.
  virtualizeLargeDocs: boolean;
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
  virtualizeLargeDocs: true,

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
  // ‼️ 정규화는 clampZoomLevel 한 곳에만 있다. 여기에 범위/정밀도를 다시 적으면
  // use-zoom.ts와 갈라져 "한쪽만 고쳐진" 상태가 되고, 그게 부드러운 핀치가
  // 죽어 있던 원인이었다 (utils/zoom.ts 주석의 측정값 참조).
  setZoomLevel: (zoomLevel) => set({ zoomLevel: clampZoomLevel(zoomLevel) }),
  setSpellCheck: (spellCheck) => set({ spellCheck }),
  setVirtualizeLargeDocs: (virtualizeLargeDocs) => set({ virtualizeLargeDocs }),

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
