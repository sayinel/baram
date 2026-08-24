// §283 PDF 사이드 레일 폭의 순수 규칙.
//
// 컴포넌트 디렉터리가 아니라 여기 있는 이유: 설정 슬라이스
// (stores/settings/editor-settings.ts)가 기본값과 clamp를 쓴다. 스토어가
// components/를 import하면 레이어가 뒤집히고, 마침 그 컴포넌트 모듈은
// stores/ui/ui를 (지금은 타입으로만) import하고 있어서 그 한 줄이 값 import로
// 바뀌는 순간 순환이 된다.

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
 * 드래그로 줄일 수 있는 하한.
 *
 * ‼️ 180인 이유: 이보다 좁으면 하이라이트 목록의 **영문** 액션 버튼
 * ("Delete permanently")이 한 줄에 안 들어간다. 처음엔 140으로 두고 "여기서는
 * 들어간다"고 적었는데 **거짓이었다** — 리뷰가 CSS를 실제로 계산해 잡았다:
 * 레일 140 − 목록 padding 16 − 액션 줄 padding 12 = 112px인데, 두 버튼의
 * min-content 합은 gap 포함 ~130px이다. 한국어("완전 삭제")는 짧아서 개발
 * 중에는 안 보였다.
 *
 * 그래서 하한을 올리는 것과 **함께** 버튼이 줄바꿈하도록 고쳤다
 * (pdf-side-panel.css). 둘 중 하나만으로는 다음 번역에서 같은 자리가 다시
 * 깨진다 — 폭은 번역 길이를 모르고, 번역은 하한을 모른다.
 */
export const PDF_RAIL_MIN_WIDTH_PX = 180;

/** 저장할 수 있는 상한. 화면에 실제로 적용되는 상한은 fitRailWidth가 정한다. */
export const PDF_RAIL_MAX_WIDTH_PX = 420;

/**
 * 레일이 있어도 본문 페이지에 남겨야 하는 최소 폭(CSS px).
 *
 * ‼️ 이 상수가 막는 것: 저장된 폭이 **좁은 창으로 따라오는** 상황이다.
 * 넓은 창에서 420으로 끌어 두면 그 값이 영속되는데, 사이드바와 우측 패널을
 * 연 640px 창에서는 편집 영역이 ~332px이라 `availableFitWidth`가 **음수**가
 * 된다. 그러면 baseScale이 0으로 남고 `pagesReady`가 false가 되어 페이지·툴바·
 * 레일이 **전부** 사라진다 — 오류 화면도 아니고, 레일 토글조차 없어서 앱
 * 안에서는 되돌릴 방법이 없다(실측: avail = −136).
 */
const PDF_MIN_PAGE_WIDTH_PX = 120;

/** 페이지 좌우 여백 — PdfPreview의 PAGE_GUTTER_PX와 같은 값이어야 한다. */
const PDF_PAGE_GUTTER_PX = 24;

/** 레일 폭을 저장 가능한 범위로 자른다. 저장 시점과 드래그 중 양쪽에서 쓴다. */
export function clampRailWidth(width: number): number {
  if (!Number.isFinite(width)) return PDF_RAIL_DEFAULT_WIDTH_PX;
  return Math.round(
    Math.min(PDF_RAIL_MAX_WIDTH_PX, Math.max(PDF_RAIL_MIN_WIDTH_PX, width)),
  );
}

/**
 * 저장된 폭을 **이 창에서 실제로 쓸 폭**으로 줄인다.
 *
 * 저장값은 사용자의 의도이고, 이 함수는 그 의도를 현재 창에 맞춘다 — 창을
 * 다시 넓히면 저장값이 그대로 돌아온다(줄어든 값을 저장하지 않는다).
 *
 * 하한(PDF_RAIL_MIN_WIDTH_PX) **아래로도** 내려갈 수 있다. 폭 60px짜리 레일은
 * 쓸모가 없지만, 그 대안은 아무것도 안 보이는 화면이다. 창을 넓히는 순간
 * 원래대로 돌아온다.
 *
 * @param containerWidth 스크롤 컨테이너의 clientWidth. 아직 못 쟀으면 0 —
 *   그때는 저장값을 그대로 쓴다(첫 렌더에서 레일을 0으로 접지 않기 위해서다).
 */
export function fitRailWidth(
  storedWidth: number,
  containerWidth: number,
): number {
  const stored = clampRailWidth(storedWidth);
  if (containerWidth <= 0) return stored;
  const room = containerWidth - PDF_PAGE_GUTTER_PX * 2 - PDF_MIN_PAGE_WIDTH_PX;
  return Math.max(0, Math.min(stored, room));
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
 * ‼️ 여기서는 clamp하지 않는다. 입력은 fitRailWidth를 이미 통과한 "화면에
 * 실제로 쓰는 폭"이고, 그것은 하한 아래일 수 있다(위 doc comment). 다시
 * 자르면 좁은 창에서 레일 상자보다 넓은 썸네일이 그려진다.
 *
 * 빼는 50px은 레일의 좌우 여백과 스크롤바 몫이다(pdf-side-panel.css).
 */
export function railContentWidth(railWidth: number): number {
  return Math.max(0, railWidth - 50);
}
