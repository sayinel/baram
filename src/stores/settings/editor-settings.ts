import type { EditorTypography } from "../../appearance/editor-typography";
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
  /** §354 코드 전용 크기·줄 높이. `linkFontMetrics` 가 켜져 있는 동안에는
   * **읽히지 않는다** — 그때 코드 값은 본문에서 파생한다(`code-metrics.ts`).
   * 연동을 끄는 순간 그 파생값이 여기 적히므로, 슬라이더는 늘 지금 화면에
   * 보이는 크기에서 출발한다. */
  codeFontSize: number;
  codeLineHeight: number;
  diagrams: boolean;
  /** §365 본문 폭 행이 보이는 단위(스펙 0060 §8.3) — 표시 선택이라 다이얼이 아니다(계획 0107 P10). */
  editorWidthUnit: EditorWidthUnit;
  extensionSettings: Record<string, unknown>;
  highlight: boolean;
  inlineMath: boolean;
  lineNumbers: boolean;
  /** §354 켜져 있으면 코드 크기·줄 높이가 본문을 따른다(기본값). 끄면 독립. */
  linkFontMetrics: boolean;
  /** §283 PDF 사이드 레일의 폭(CSS px). 드래그로 조절하고 재시작 뒤에도 남는다.
   * clampRailWidth 범위 밖의 값은 setter가 자른다. */
  pdfRailWidth: number;
  pushRecentFont: (family: string) => void;
  /** §377 기호·이모지를 넣을 때마다 — 격자 선택기와 `:` 자동완성 둘 다 부른다. */
  pushRecentSymbol: (char: string) => void;
  /** §348 최근 사용 서체 — 최신이 앞, 최대 5개. 두 슬롯이 공유한다. */
  recentFonts: string[];
  /** §377 최근 넣은 기호·이모지 — 최신이 앞, 최대 {@link RECENT_SYMBOLS_MAX}개. 격자의 "최근" 절만 읽는다. */
  recentSymbols: string[];
  setAutoLoadVideoEmbeds: (enabled: boolean) => void;
  setAutoPairBrackets: (enabled: boolean) => void;
  setCodeBlockLineNumbers: (enabled: boolean) => void;
  setCodeBlockStyle: (style: CodeBlockStyle) => void;
  setCodeFontSize: (size: number) => void;
  setCodeLineHeight: (height: number) => void;
  setDiagrams: (enabled: boolean) => void;
  setEditorWidthUnit: (unit: EditorWidthUnit) => void;
  setExtensionSetting: (key: string, value: unknown) => void;
  setHighlight: (enabled: boolean) => void;
  setInlineMath: (enabled: boolean) => void;
  setLineNumbers: (enabled: boolean) => void;
  setLinkFontMetrics: (
    linked: boolean,
    body: Pick<EditorTypography, "fontSize" | "lineHeight">,
  ) => void;
  setPdfRailWidth: (width: number) => void;
  setSmartPunctuation: (enabled: boolean) => void;
  setSpellCheck: (enabled: boolean) => void;
  setStrikethrough: (enabled: boolean) => void;
  setSymbolSuggest: (enabled: boolean) => void;
  setTabSize: (size: number) => void;
  setVimMode: (enabled: boolean) => void;
  setVirtualizeLargeDocs: (enabled: boolean) => void;
  setZoomLevel: (level: number) => void;
  smartPunctuation: boolean;
  spellCheck: boolean;
  strikethrough: boolean;
  symbolSuggest: boolean;
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

/** §365 본문 폭 행의 표시 단위 — 저장값(px)의 두 표현 중 어느 것을 보이는가. */
export type EditorWidthUnit = "chars" | "px";

/**
 * §377 최근 사용 기호의 상한. 격자 한 줄이 8칸(`components/command/symbol-grid-nav.ts` 의
 * `SYMBOL_GRID_COLUMNS`)이라 세 줄이다.
 */
export const RECENT_SYMBOLS_MAX = 24;

export const createEditorSettingsSlice: StateCreator<
  EditorSettingsSlice,
  [],
  [],
  EditorSettingsSlice
> = (set) => ({
  // Editor
  // §365 본문 서체 · 코드 서체 · 크기 · 줄 높이는 외관 다이얼이다(`appearance/dials.ts`, 스펙 0060) — v28 이 옮겼다.
  recentFonts: [],
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
  pdfRailWidth: PDF_RAIL_DEFAULT_WIDTH_PX,
  zoomLevel: 1,
  spellCheck: false,
  vimMode: false,
  virtualizeLargeDocs: true,
  // §365 표시 선택의 기본값은 오늘 동작(글자 수로 보인다)과 같다 — store version 을 올리지 않는다.
  editorWidthUnit: "chars",

  // Markdown
  inlineMath: true,
  highlight: true,
  strikethrough: true,
  diagrams: true,
  codeBlockLineNumbers: false,
  codeBlockStyle: "default",
  smartPunctuation: false,
  symbolSuggest: true,
  // §377 기본값 `[]` 은 오늘 동작(최근 절 없음)과 같다 — store version 을 올리지 않는다.
  recentSymbols: [],

  // Extension settings (dynamic key-value)
  extensionSettings: {},

  // Editor setters
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
  // §377 pushRecentFont 와 같은 모양. 무동작이면 state 를 그대로 돌려준다 — 동등성 관문.
  pushRecentSymbol: (char) =>
    set((state) => {
      if (char === "" || state.recentSymbols[0] === char) return state;
      return {
        recentSymbols: [
          char,
          ...state.recentSymbols.filter((c) => c !== char),
        ].slice(0, RECENT_SYMBOLS_MAX),
      };
    }),
  setCodeFontSize: (codeFontSize) => set({ codeFontSize }),
  setCodeLineHeight: (codeLineHeight) => set({ codeLineHeight }),
  // 연동을 끌 때만 코드 값을 채운다 — 켤 때는 손대지 않는다. 켜는 동안 그 값을
  // 읽는 곳이 없으므로 지우는 것과 남기는 것의 차이가 화면에 없고, 다음에 끌 때
  // 어차피 그 시점의 파생값으로 다시 덮인다. 반올림은 여기서 한 번만 한다:
  // 슬라이더는 정수 px 스텝이라 14.875 에서 출발하면 첫 드래그에 값이 튄다.
  //
  // §365 파생의 입력(`body`)은 호출자가 넘긴다 — 본문 크기 · 줄 높이는 이제 외관 다이얼의
  // **병합값**이고(테마가 줄 수 있다), 그 병합은 이 슬라이스가 모르는 테마 층을 읽는다.
  // 스토어가 병합을 계산하게 하면 이 모듈이 외관 · 플러그인 스토어를 import 해야 한다(스펙 0060 D8).
  setLinkFontMetrics: (linkFontMetrics, body) =>
    set(() => {
      if (linkFontMetrics) return { linkFontMetrics };
      return {
        codeFontSize: Math.round(derivedCodeFontSize(body.fontSize)),
        codeLineHeight: body.lineHeight,
        linkFontMetrics,
      };
    }),
  setTabSize: (tabSize) => set({ tabSize }),
  setLineNumbers: (lineNumbers) => set({ lineNumbers }),
  setAutoPairBrackets: (autoPairBrackets) => set({ autoPairBrackets }),
  setAutoLoadVideoEmbeds: (autoLoadVideoEmbeds) => set({ autoLoadVideoEmbeds }),
  // ‼️ 정규화는 clampZoomLevel 한 곳에만 있다. 여기에 범위/정밀도를 다시 적으면
  // use-zoom.ts와 갈라져 "한쪽만 고쳐진" 상태가 되고, 그게 부드러운 핀치가
  // 죽어 있던 원인이었다 (utils/zoom.ts 주석의 측정값 참조).
  setPdfRailWidth: (width) => set({ pdfRailWidth: clampRailWidth(width) }),

  setZoomLevel: (zoomLevel) => set({ zoomLevel: clampZoomLevel(zoomLevel) }),
  setSpellCheck: (spellCheck) => set({ spellCheck }),
  setVimMode: (vimMode) => set({ vimMode }),
  setVirtualizeLargeDocs: (virtualizeLargeDocs) => set({ virtualizeLargeDocs }),
  setEditorWidthUnit: (editorWidthUnit) => set({ editorWidthUnit }),

  // Markdown setters
  setInlineMath: (inlineMath) => set({ inlineMath }),
  setHighlight: (highlight) => set({ highlight }),
  setStrikethrough: (strikethrough) => set({ strikethrough }),
  setSmartPunctuation: (smartPunctuation) => set({ smartPunctuation }),
  setSymbolSuggest: (symbolSuggest) => set({ symbolSuggest }),

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
