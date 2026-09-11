import type { StateCreator } from "zustand";

import { derivedCodeFontSize } from "../../utils/font/code-metrics";
import {
  clampRailWidth,
  PDF_RAIL_DEFAULT_WIDTH_PX,
} from "../../utils/pdf-rail-width";
import { clampZoomLevel } from "../../utils/zoom";

export interface EditorSettingsSlice {
  /** §17.2-8의 클릭-게이트를 사용자 선택으로 만든 설정. 켜면(기본값) 문서를 여는
   * 순간 provider(youtube-nocookie / player.vimeo.com)에 요청이 나가고, 끄면
   * 클릭 전까지 네트워크 요청이 0이다. */
  autoLoadVideoEmbeds: boolean;
  autoPairBrackets: boolean;
  codeBlockLineNumbers: boolean;
  codeBlockStyle: CodeBlockStyle;
  /** §348 코드 서체 슬롯 — 코드 블록·수식·표가 읽는 `--font-family-mono`.
   * 빈 문자열은 "설정 없음"이고 토큰 스택을 그대로 쓴다는 뜻이다. */
  codeFontFamily: string;
  /** §354 코드 전용 크기·줄 높이. `linkFontMetrics` 가 켜져 있는 동안에는
   * **읽히지 않는다** — 그때 코드 값은 본문에서 파생한다(`code-metrics.ts`).
   * 연동을 끄는 순간 그 파생값이 여기 적히므로, 슬라이더는 늘 지금 화면에
   * 보이는 크기에서 출발한다. */
  codeFontSize: number;
  codeLineHeight: number;
  diagrams: boolean;
  editorMaxWidth: number;
  extensionSettings: Record<string, unknown>;
  fontFamily: string;
  fontSize: number;
  highlight: boolean;
  inlineMath: boolean;
  lineHeight: number;
  lineNumbers: boolean;
  /** §354 켜져 있으면 코드 크기·줄 높이가 본문을 따른다(기본값). 끄면 독립. */
  linkFontMetrics: boolean;
  /** §283 PDF 사이드 레일의 폭(CSS px). 드래그로 조절하고 재시작 뒤에도 남는다.
   * clampRailWidth 범위 밖의 값은 setter가 자른다. */
  pdfRailWidth: number;
  pushRecentFont: (family: string) => void;
  /** §348 최근 사용 서체 — 최신이 앞, 최대 5개. 두 슬롯이 공유한다. */
  recentFonts: string[];
  setAutoLoadVideoEmbeds: (enabled: boolean) => void;
  setAutoPairBrackets: (enabled: boolean) => void;
  setCodeBlockLineNumbers: (enabled: boolean) => void;
  setCodeBlockStyle: (style: CodeBlockStyle) => void;
  setCodeFontFamily: (family: string) => void;
  setCodeFontSize: (size: number) => void;
  setCodeLineHeight: (height: number) => void;
  setDiagrams: (enabled: boolean) => void;
  setEditorMaxWidth: (width: number) => void;
  setExtensionSetting: (key: string, value: unknown) => void;
  setFontFamily: (family: string) => void;
  setFontSize: (size: number) => void;
  setHighlight: (enabled: boolean) => void;
  setInlineMath: (enabled: boolean) => void;
  setLineHeight: (height: number) => void;
  setLineNumbers: (enabled: boolean) => void;
  setLinkFontMetrics: (linked: boolean) => void;
  setPdfRailWidth: (width: number) => void;
  setSmartPunctuation: (enabled: boolean) => void;
  setSpellCheck: (enabled: boolean) => void;
  setStrikethrough: (enabled: boolean) => void;
  setTabSize: (size: number) => void;
  setVimMode: (enabled: boolean) => void;
  setVirtualizeLargeDocs: (enabled: boolean) => void;
  setZoomLevel: (level: number) => void;
  smartPunctuation: boolean;
  spellCheck: boolean;
  strikethrough: boolean;
  tabSize: number;
  // §298 Vim keybindings in source mode (Phase 0a). Off by default; the vim
  // module is dynamically imported only when enabled.
  vimMode: boolean;
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
  // §348 두 서체 슬롯의 기본값은 빈 문자열 = "설정 없음" = 토큰 스택을 그대로.
  //
  // `fontFamily` 에 있던 `"Pretendard"` 를 지운 것은 동작 변경이 아니다: 그 이름의
  // 서체는 어디에도 번들되어 있지 않았고(§346), 그래서 인라인 선언은 늘 뒤의
  // `var(--font-family-editor)` 로 떨어졌다. 그 스택의 첫 항목이 이제 실재하는
  // `"Pretendard Variable"` 이므로 화면에 나오는 서체가 같다 — 그래서 backfill
  // 마이그레이션도, `store.ts` 의 `version` 상승도 필요하지 않다. 설정 창의 입력
  // 칸은 빈 값에서 placeholder("Type or select a font…")를 보여 준다.
  fontFamily: "",
  codeFontFamily: "",
  recentFonts: [],
  fontSize: 16,
  lineHeight: 1.75,
  // §354 기본은 연동이다. 아래 두 값은 연동을 끄기 전까지 읽히지 않으므로
  // 기본 상태의 화면은 이 설정이 생기기 전과 같다 — 그래서 store version 을
  // 올릴 이유도, 기존 사용자를 위한 backfill 도 없다.
  linkFontMetrics: true,
  codeFontSize: 14,
  codeLineHeight: 1.75,
  tabSize: 2,
  lineNumbers: false,
  autoPairBrackets: true,
  autoLoadVideoEmbeds: true,
  editorMaxWidth: 800,
  pdfRailWidth: PDF_RAIL_DEFAULT_WIDTH_PX,
  zoomLevel: 1,
  spellCheck: false,
  vimMode: false,
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
  setCodeFontFamily: (codeFontFamily) => set({ codeFontFamily }),
  setFontFamily: (fontFamily) => set({ fontFamily }),
  /**
   * §348 최근 사용 서체 — 최신이 앞, 최대 5개, 중복은 앞으로 승격.
   *
   * 목록은 슬롯 공용이고 표시할 때 슬롯별로 필터한다(코드 슬롯에서는
   * monospaced 인 것만). 두 목록을 따로 두면 같은 서체를 두 번 기억한다.
   *
   * ‼️ 무동작일 때 `state` 를 **그대로** 돌려준다. zustand 는 반환값이 현재
   * state 와 같은 객체일 때만 리스너를 건너뛴다 — `{ recentFonts: state.recentFonts }`
   * 같은 partial 은 새 root 가 되어 아무것도 안 바뀌었는데 모든 구독자를 깨운다.
   */
  pushRecentFont: (family) =>
    set((state) => {
      const name = family.trim();
      if (name === "") return state;
      if (state.recentFonts[0] === name) return state; // 동등성 관문
      return {
        recentFonts: [
          name,
          ...state.recentFonts.filter((f) => f !== name),
        ].slice(0, 5),
      };
    }),
  setFontSize: (fontSize) => set({ fontSize }),
  setLineHeight: (lineHeight) => set({ lineHeight }),
  setCodeFontSize: (codeFontSize) => set({ codeFontSize }),
  setCodeLineHeight: (codeLineHeight) => set({ codeLineHeight }),
  // 연동을 끌 때만 코드 값을 채운다 — 켤 때는 손대지 않는다. 켜는 동안 그 값을
  // 읽는 곳이 없으므로 지우는 것과 남기는 것의 차이가 화면에 없고, 다음에 끌 때
  // 어차피 그 시점의 파생값으로 다시 덮인다. 반올림은 여기서 한 번만 한다:
  // 슬라이더는 정수 px 스텝이라 14.875 에서 출발하면 첫 드래그에 값이 튄다.
  setLinkFontMetrics: (linkFontMetrics) =>
    set((state) => {
      if (linkFontMetrics) return { linkFontMetrics };
      return {
        codeFontSize: Math.round(derivedCodeFontSize(state.fontSize)),
        codeLineHeight: state.lineHeight,
        linkFontMetrics,
      };
    }),
  setTabSize: (tabSize) => set({ tabSize }),
  setLineNumbers: (lineNumbers) => set({ lineNumbers }),
  setAutoPairBrackets: (autoPairBrackets) => set({ autoPairBrackets }),
  setAutoLoadVideoEmbeds: (autoLoadVideoEmbeds) => set({ autoLoadVideoEmbeds }),
  setEditorMaxWidth: (editorMaxWidth) => set({ editorMaxWidth }),
  // ‼️ 정규화는 clampZoomLevel 한 곳에만 있다. 여기에 범위/정밀도를 다시 적으면
  // use-zoom.ts와 갈라져 "한쪽만 고쳐진" 상태가 되고, 그게 부드러운 핀치가
  // 죽어 있던 원인이었다 (utils/zoom.ts 주석의 측정값 참조).
  setPdfRailWidth: (width) => set({ pdfRailWidth: clampRailWidth(width) }),

  setZoomLevel: (zoomLevel) => set({ zoomLevel: clampZoomLevel(zoomLevel) }),
  setSpellCheck: (spellCheck) => set({ spellCheck }),
  setVimMode: (vimMode) => set({ vimMode }),
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
