// §282 사이드 레일의 순수 규칙 — 탭 해석.
//
// 컴포넌트 파일에서 분리한 이유는 wikilink-suggest-utils.ts와 같다: 상수/순수
// 함수를 컴포넌트와 같은 모듈에서 export하면 Fast Refresh가 그 파일 전체를
// 컴포넌트로 취급하지 못한다(react-refresh/only-export-components).
//
// §283 폭 규칙은 여기 있다가 src/utils/pdf-rail-width.ts로 옮겨 갔다 — 설정
// 슬라이스가 그 기본값을 쓰는데, 스토어가 components/를 import하면 레이어가
// 뒤집히기 때문이다(리뷰 LOW-6).
import type { PdfRailTab } from "../../../stores/ui/ui";

/**
 * 실제로 그릴 탭. 하이라이트는 vault 안에서만 지원되므로(사이드카·동반 노트가
 * vault 상대 경로로 식별된다, use-pdf-highlights.ts 참조) vault 밖에서는
 * 하이라이트 탭이 존재하지 않는다.
 *
 * ‼️ 그런데 탭 선택은 스토어에 남는다 — vault PDF에서 하이라이트 탭을 보다가
 * vault 밖 PDF를 열면 요청된 탭은 여전히 "highlights"다. 이 함수가 없으면 그
 * 경우 탭 버튼은 하나뿐인데 본문은 빈 채로 남는다(고를 수 있는 것이 없는데
 * 아무것도 안 보이는 상태). 스토어 값을 건드리지 않고 표시 시점에만 접는 이유는
 * vault PDF로 돌아왔을 때 원래 보던 탭이 그대로 살아 있어야 하기 때문이다.
 */
export function resolvePdfRailTab(
  requested: PdfRailTab,
  highlightsEnabled: boolean,
): PdfRailTab {
  return requested === "highlights" && !highlightsEnabled ? "pages" : requested;
}
