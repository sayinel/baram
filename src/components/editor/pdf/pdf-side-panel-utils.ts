// §282 사이드 레일의 순수 규칙 — 폭 상수와 탭 해석.
//
// 컴포넌트 파일에서 분리한 이유는 wikilink-suggest-utils.ts와 같다: 상수/순수
// 함수를 컴포넌트와 같은 모듈에서 export하면 Fast Refresh가 그 파일 전체를
// 컴포넌트로 취급하지 못한다(react-refresh/only-export-components). PdfPreview가
// PDF_RAIL_WIDTH_PX를 쓰려고 컴포넌트 모듈을 끌어오지 않아도 된다는 이점도 있다.
import type { PdfRailTab } from "../../../stores/ui/ui";

/**
 * 레일 기본 폭(CSS px). §283 이전에는 이 값이 **고정 상수**였고, 지금은
 * 설정(`pdfRailWidth`)의 초기값이다.
 *
 * 값이 어디로 흐르는지는 그대로다 — CSS는 `--pdf-rail-width` 커스텀 속성으로
 * 받아 쓰고(PdfPreview가 인라인으로 내려준다), fit-width 계산(availableFitWidth)도
 * 같은 값을 뺀다. CSS에 폭을 따로 적으면 둘이 어긋나는 순간 "zoom 100%인데
 * 항상 가로 스크롤이 생긴다"로 나타난다.
 */
export const PDF_RAIL_DEFAULT_WIDTH_PX = 200;

/**
 * §283 드래그로 줄일 수 있는 하한. 이보다 좁으면 썸네일이 페이지인지 분간이
 * 안 되고(콘텐츠 폭이 90px 아래로 내려간다), 하이라이트 목록의 두 액션 버튼이
 * 한 줄에 못 들어간다.
 */
export const PDF_RAIL_MIN_WIDTH_PX = 140;

/**
 * §283 상한. 본문이 설 자리를 남기기 위한 값이다 — 이보다 넓히면 좁은 창에서
 * availableFitWidth가 음수가 되어 페이지가 아예 안 그려진다(그 경우를 위한
 * `avail > 0` 가드가 PdfPreview에 있지만, 그건 창을 줄였을 때의 방어이지
 * 사용자가 드래그로 도달할 상태는 아니다).
 */
export const PDF_RAIL_MAX_WIDTH_PX = 420;

/** 레일 폭을 허용 범위로 자른다. 저장 시점과 드래그 중 양쪽에서 쓴다. */
export function clampRailWidth(width: number): number {
  if (!Number.isFinite(width)) return PDF_RAIL_DEFAULT_WIDTH_PX;
  return Math.round(
    Math.min(PDF_RAIL_MAX_WIDTH_PX, Math.max(PDF_RAIL_MIN_WIDTH_PX, width)),
  );
}

/**
 * 레일 폭 → 안쪽 콘텐츠 폭(CSS px). 썸네일과 영역 크롭이 함께 쓴다.
 *
 * 파생시키는 이유는 §282에서 상수를 단일 출처로 둔 이유와 똑같다. 리뷰에서
 * 지적됐듯 처음엔 150이 두 파일에 각각 하드코딩돼 있었고, 양쪽에 "레일 폭이
 * 바뀌면 여기도 보라"는 주석만 달려 있었다 — 그 주석이 필요하다는 것 자체가
 * 값이 파생돼야 한다는 신호다. §283에서 폭이 **움직이게** 되면서 그 신호가
 * 실제 결함이 됐을 자리다.
 *
 * 빼는 50px은 레일의 좌우 여백과 스크롤바 몫이다(pdf-side-panel.css).
 */
export function railContentWidth(railWidth: number): number {
  return clampRailWidth(railWidth) - 50;
}

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
