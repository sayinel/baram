// §276.3.1 하이라이트 생성 모드 — 세 가지 상태(사용자 판단, 원래 §276.3
// 설계를 뒤집는다).
//
// 원래 §276.3은 텍스트에는 모드가 필요 없다고 했다(선택이 곧 진입점) — 하지만
// 그러면 "그냥 드래그해서 선택하고 Cmd+C로 복사"라는 PDF 리더에서 아주
// 평범한 동작이 매번 하이라이트 팝업을 띄우게 된다. 그 흠을 사용자가 직접
// 짚었다: 일반 선택과 텍스트 하이라이트를 모드로 구분해야 한다.
//
// 세 상태 — "none"(기본, 평범한 선택 + Cmd+C, 팝업 없음) · "text"(선택하면
// 팝업) · "area"(드래그로 사각형). 하나의 enum으로 표현하는 이유는 상호
// 배타성이 "다른 쪽을 끄는 로직"이 아니라 "변수 하나"이기 때문이다 —
// text를 켜면 area는 자동으로 꺼진다(같은 변수의 다른 값이므로). 두 개의
// 독립된 boolean으로 만들면 두 토글 함수가 서로를 알아야 하는 결합이
// 생긴다.
//
// 이 훅은 상태만 갖는다 — 그 상태를 소비해 무엇을 하는지는 모른다:
// use-pdf-selection-popup.ts(mode === "text"일 때만 감지)와
// use-pdf-area-highlight.ts(mode === "area" || Alt 홀드일 때 드래그 시작)가
// 각자 이 값을 읽는다. 두 소비처를 합치지 않는 이유는 각자 다른
// 관심사(언제 여는가 vs 어떻게 그리는가)를 이미 갖고 있어서다.
import { useCallback, useState } from "react";

export type PdfHighlightMode = "area" | "none" | "text";

export interface UsePdfHighlightModeResult {
  mode: PdfHighlightMode;
  /** 이미 area면 꺼서 "none"으로, 아니면 "area"로 — text가 켜져 있었다면
   * 자동으로 꺼진다(같은 변수라서). */
  toggleAreaMode: () => void;
  /** 대칭적으로 text에 대해 같은 동작. */
  toggleTextMode: () => void;
}

export function usePdfHighlightMode(): UsePdfHighlightModeResult {
  const [mode, setMode] = useState<PdfHighlightMode>("none");

  const toggleAreaMode = useCallback(() => {
    setMode((m) => (m === "area" ? "none" : "area"));
  }, []);

  const toggleTextMode = useCallback(() => {
    setMode((m) => (m === "text" ? "none" : "text"));
  }, []);

  return { mode, toggleAreaMode, toggleTextMode };
}
