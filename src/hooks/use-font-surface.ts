// §349 리뷰 Important 1 — `.tiptap` 밖으로 포털되는 문서 오버레이용 배선.
//
// 전체화면 mermaid·SVG·이미지 오버레이는 `createPortal(…, document.body)` 로
// 그려지므로 문서 표면의 CSS 변수를 하나도 상속받지 못한다. 그 오버레이의
// 소스 textarea 는 앱에서 코드 서체와 가장 관련이 깊은 표면인데, 표면 배선이
// 없으면 인라인 편집기는 사용자 서체로 변하고 그 전체화면 쌍둥이만 기본값으로
// 남는다.
//
// ref 콜백 하나로 주는 이유: 오버레이 루트는 조건부로 마운트되고(열려 있을 때만
// 존재한다) 컴포넌트마다 다른 요소다. `useRef` + effect 조합은 요소가 언제
// 붙었는지 effect 가 알 수 없어 첫 마운트를 놓친다 — 콜백 ref 를 state 로 받으면
// 요소가 착지한 렌더에서 effect 가 다시 돈다.
import { useEffect, useState } from "react";

import type { FontSurfaceScope } from "../utils/editor/font-surfaces";

import { useShallow } from "zustand/shallow";

import { useSettingsStore } from "../stores/settings/store";
import { applyFontVariables } from "../utils/editor/font-surfaces";

/**
 * 표면 루트에 붙일 ref 콜백. 열려 있는 동안의 설정 변경도 따라간다.
 *
 * 마운트 시점 한 번만 읽으면 설정 창과 오버레이가 동시에 열린 흔한 경우에
 * 갈라진다 — 그래서 effect 의 deps 에 두 슬롯이 들어 있다.
 */
export function useFontSurface(
  which: FontSurfaceScope,
): (el: HTMLElement | null) => void {
  const [surface, setSurface] = useState<HTMLElement | null>(null);
  const { codeFontFamily, fontFamily } = useSettingsStore(
    useShallow((s) => ({
      codeFontFamily: s.codeFontFamily,
      fontFamily: s.fontFamily,
    })),
  );

  useEffect(() => {
    if (!surface) return;
    applyFontVariables(surface, {
      bodyFont: fontFamily,
      codeFont: codeFontFamily,
      which,
    });
  }, [surface, fontFamily, codeFontFamily, which]);

  return setSurface;
}
